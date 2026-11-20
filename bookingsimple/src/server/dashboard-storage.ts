import "server-only";

import type { Container, PartitionKey } from "@azure/cosmos";
import { StorageError } from "./auth-storage";
import { bookingContainer } from "./booking-storage";
import type { BookingDocument } from "./booking-types";
import { conversationContainer } from "./conversation-storage";
import type { ConversationDocument } from "./conversation-types";
import { reminderContainer } from "./reminder-storage";
import type { ReminderDocument } from "./reminder-types";

type QueryParameter = {
  name: string;
  value: string | number | boolean | null;
};

export type DashboardStoredData = {
  todayCount: number;
  upcomingCount: number;
  attentionCount: number;
  awaitingDepositCount: number;
  failedReminderCount: number;
  todayBookings: BookingDocument[];
  upcomingBookings: BookingDocument[];
  awaitingDepositBookings: BookingDocument[];
  attentionConversations: ConversationDocument[];
  failedReminders: ReminderDocument[];
};

async function queryCount(
  container: Container,
  query: string,
  parameters: QueryParameter[],
  partitionKey?: PartitionKey,
): Promise<number> {
  const response = await container.items
    .query<number>(
      { query, parameters },
      partitionKey === undefined ? undefined : { partitionKey },
    )
    .fetchNext();
  const count = response.resources[0];
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new StorageError("Dashboard count data is invalid.", 503);
  }
  return count;
}

async function queryItems<T>(
  container: Container,
  query: string,
  parameters: QueryParameter[],
  limit: number,
  partitionKey?: PartitionKey,
): Promise<T[]> {
  const response = await container.items
    .query<T>(
      { query, parameters },
      {
        ...(partitionKey === undefined ? {} : { partitionKey }),
        maxItemCount: limit,
      },
    )
    .fetchNext();
  return response.resources;
}

export async function queryDashboardStoredData(
  tenantId: string,
  now: string,
  dayStart: string,
  dayEnd: string,
  limit = 5,
): Promise<DashboardStoredData> {
  const bookingParameters: QueryParameter[] = [
    { name: "@type", value: "booking" },
    { name: "@tenantId", value: tenantId },
    { name: "@dayStart", value: dayStart },
    { name: "@dayEnd", value: dayEnd },
    { name: "@cancelled", value: "CANCELLED" },
    { name: "@pending", value: "PENDING" },
    { name: "@awaitingDeposit", value: "AWAITING_DEPOSIT" },
    { name: "@confirmed", value: "CONFIRMED" },
    { name: "@limit", value: limit },
  ];
  const todayWhere = [
    "c.type = @type",
    "c.tenantId = @tenantId",
    "c.startAt >= @dayStart",
    "c.startAt < @dayEnd",
    "c.status != @cancelled",
  ].join(" AND ");
  const upcomingWhere = [
    "c.type = @type",
    "c.tenantId = @tenantId",
    "c.startAt >= @dayEnd",
    "c.status IN (@pending, @awaitingDeposit, @confirmed)",
  ].join(" AND ");
  const awaitingDepositWhere = [
    "c.type = @type",
    "c.tenantId = @tenantId",
    "c.status = @awaitingDeposit",
  ].join(" AND ");

  const conversationParameters: QueryParameter[] = [
    { name: "@type", value: "conversation" },
    { name: "@tenantId", value: tenantId },
    { name: "@inbound", value: "INBOUND" },
    { name: "@limit", value: limit },
  ];
  const attentionWhere = [
    "c.type = @type",
    "c.tenantId = @tenantId",
    "c.lastMessageDirection = @inbound",
  ].join(" AND ");

  const reminderParameters: QueryParameter[] = [
    { name: "@type", value: "reminder" },
    { name: "@tenantId", value: tenantId },
    { name: "@failed", value: "FAILED" },
    { name: "@now", value: now },
    { name: "@limit", value: limit },
  ];
  const failedReminderWhere = [
    "c.type = @type",
    "c.tenantId = @tenantId",
    "c.status = @failed",
    "c.scheduledFor <= @now",
  ].join(" AND ");

  const bookings = bookingContainer();
  const conversations = conversationContainer();
  const reminders = reminderContainer();
  const [
    todayCount,
    upcomingCount,
    awaitingDepositCount,
    attentionCount,
    failedReminderCount,
    todayBookings,
    upcomingBookings,
    awaitingDepositBookings,
    attentionConversations,
    failedReminders,
  ] = await Promise.all([
    queryCount(
      bookings,
      `SELECT VALUE COUNT(1) FROM c WHERE ${todayWhere}`,
      bookingParameters,
      tenantId,
    ),
    queryCount(
      bookings,
      `SELECT VALUE COUNT(1) FROM c WHERE ${upcomingWhere}`,
      bookingParameters,
      tenantId,
    ),
    queryCount(
      bookings,
      `SELECT VALUE COUNT(1) FROM c WHERE ${awaitingDepositWhere}`,
      bookingParameters,
      tenantId,
    ),
    queryCount(
      conversations,
      `SELECT VALUE COUNT(1) FROM c WHERE ${attentionWhere}`,
      conversationParameters,
    ),
    queryCount(
      reminders,
      `SELECT VALUE COUNT(1) FROM c WHERE ${failedReminderWhere}`,
      reminderParameters,
      tenantId,
    ),
    queryItems<BookingDocument>(
      bookings,
      `SELECT TOP @limit * FROM c WHERE ${todayWhere} ORDER BY c.startAt ASC`,
      bookingParameters,
      limit,
      tenantId,
    ),
    queryItems<BookingDocument>(
      bookings,
      `SELECT TOP @limit * FROM c WHERE ${upcomingWhere} ORDER BY c.startAt ASC`,
      bookingParameters,
      limit,
      tenantId,
    ),
    queryItems<BookingDocument>(
      bookings,
      `SELECT TOP @limit * FROM c WHERE ${awaitingDepositWhere} ORDER BY c.startAt ASC`,
      bookingParameters,
      limit,
      tenantId,
    ),
    queryItems<ConversationDocument>(
      conversations,
      `SELECT TOP @limit * FROM c WHERE ${attentionWhere} ORDER BY c.lastMessageAt DESC`,
      conversationParameters,
      limit,
    ),
    queryItems<ReminderDocument>(
      reminders,
      `SELECT TOP @limit * FROM c WHERE ${failedReminderWhere} ORDER BY c.updatedAt DESC`,
      reminderParameters,
      limit,
      tenantId,
    ),
  ]);

  return {
    todayCount,
    upcomingCount,
    attentionCount,
    awaitingDepositCount,
    failedReminderCount,
    todayBookings,
    upcomingBookings,
    awaitingDepositBookings,
    attentionConversations,
    failedReminders,
  };
}
