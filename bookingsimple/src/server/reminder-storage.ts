import "server-only";

import type { Container } from "@azure/cosmos";
import {
  AUTH_DATABASE_ID,
  StorageError,
  type Versioned,
} from "./auth-storage";
import { getCosmosClient } from "./cosmos";
import {
  REMINDER_CONTAINER_ID,
  type ReminderDocument,
} from "./reminder-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function reminderContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(REMINDER_CONTAINER_ID);
}

export async function readReminderDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<ReminderDocument> | null> {
  try {
    const response = await reminderContainer()
      .item(id, tenantId)
      .read<ReminderDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createReminderDocument(
  document: ReminderDocument,
): Promise<Versioned<ReminderDocument>> {
  const response = await reminderContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a Reminder.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceReminderDocument(
  document: ReminderDocument,
  etag: string,
): Promise<Versioned<ReminderDocument>> {
  const response = await reminderContainer()
    .item(document.id, document.tenantId)
    .replace<ReminderDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a Reminder.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function deleteReminderDocument(
  id: string,
  tenantId: string,
): Promise<void> {
  try {
    await reminderContainer().item(id, tenantId).delete();
  } catch (error) {
    if (!isStatus(error, 404)) throw error;
  }
}

export async function queryBookingReminders(
  tenantId: string,
  bookingId: string,
): Promise<ReminderDocument[]> {
  const response = await reminderContainer().items
    .query<ReminderDocument>(
      {
        query:
          "SELECT * FROM c WHERE c.type = @type AND c.bookingId = @bookingId ORDER BY c.scheduledFor ASC",
        parameters: [
          { name: "@type", value: "reminder" },
          { name: "@bookingId", value: bookingId },
        ],
      },
      { partitionKey: tenantId, maxItemCount: 10 },
    )
    .fetchNext();
  if (response.continuationToken) {
    throw new StorageError(
      "The Booking has more Reminder records than the supported limit.",
      503,
    );
  }
  return response.resources;
}

export async function queryDueReminders(
  dueAt: string,
  limit: number,
  tenantId?: string,
): Promise<ReminderDocument[]> {
  const iterator = reminderContainer().items.query<ReminderDocument>(
    {
      query: [
        "SELECT TOP @limit * FROM c",
        "WHERE c.type = @type AND c.scheduledFor <= @dueAt",
        "AND (",
        "(c.status IN (@pending, @failed) AND c.nextAttemptAt <= @dueAt)",
        "OR (c.status = @processing AND c.processingLeaseExpiresAt <= @dueAt)",
        ")",
        "ORDER BY c.scheduledFor ASC",
      ].join(" "),
      parameters: [
        { name: "@limit", value: limit },
        { name: "@type", value: "reminder" },
        { name: "@dueAt", value: dueAt },
        { name: "@pending", value: "PENDING" },
        { name: "@failed", value: "FAILED" },
        { name: "@processing", value: "PROCESSING" },
      ],
    },
    {
      ...(tenantId ? { partitionKey: tenantId } : {}),
      maxItemCount: limit,
    },
  );
  return (await iterator.fetchNext()).resources ?? [];
}
