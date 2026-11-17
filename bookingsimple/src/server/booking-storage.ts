import "server-only";

import type { Container } from "@azure/cosmos";
import { getCosmosClient } from "./cosmos";
import {
  AUTH_DATABASE_ID,
  StorageError,
  type QueryPage,
  type Versioned,
} from "./auth-storage";
import {
  BOOKING_CONTAINER_ID,
  type BookingDocument,
} from "./booking-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function bookingContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(BOOKING_CONTAINER_ID);
}

export async function readBookingDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<BookingDocument> | null> {
  try {
    const response = await bookingContainer()
      .item(id, tenantId)
      .read<BookingDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createBookingDocument(
  document: BookingDocument,
): Promise<Versioned<BookingDocument>> {
  const response = await bookingContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a Booking.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceBookingDocument(
  document: BookingDocument,
  etag: string,
): Promise<Versioned<BookingDocument>> {
  const response = await bookingContainer()
    .item(document.id, document.tenantId)
    .replace<BookingDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a Booking.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function queryBookingPage(
  tenantId: string,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<BookingDocument>> {
  const iterator = bookingContainer().items.query<BookingDocument>(
    { query, parameters },
    {
      partitionKey: tenantId,
      maxItemCount: pageSize,
      continuationToken: continuationToken || undefined,
    },
  );
  const page = await iterator.fetchNext();
  return {
    items: page.resources,
    continuationToken: page.continuationToken || undefined,
  };
}
