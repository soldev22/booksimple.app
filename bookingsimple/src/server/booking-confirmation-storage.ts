import "server-only";

import type { Container } from "@azure/cosmos";
import { getCosmosClient } from "./cosmos";
import {
  AUTH_DATABASE_ID,
  StorageError,
  type Versioned,
} from "./auth-storage";
import {
  BOOKING_CONFIRMATION_CONTAINER_ID,
  type BookingConfirmationDocument,
} from "./booking-confirmation-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

function bookingConfirmationContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(BOOKING_CONFIRMATION_CONTAINER_ID);
}

export async function createBookingConfirmation(
  document: BookingConfirmationDocument,
): Promise<Versioned<BookingConfirmationDocument>> {
  const response =
    await bookingConfirmationContainer().items.create(document, {
      accessCondition: { type: "IfNoneMatch", condition: "*" },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError(
      "Database create did not return a Booking confirmation.",
      503,
    );
  }
  return { document: response.resource, etag: response.etag };
}

export async function readBookingConfirmation(
  id: string,
  tenantId: string,
): Promise<Versioned<BookingConfirmationDocument> | null> {
  try {
    const response = await bookingConfirmationContainer()
      .item(id, tenantId)
      .read<BookingConfirmationDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function replaceBookingConfirmation(
  document: BookingConfirmationDocument,
  etag: string,
): Promise<Versioned<BookingConfirmationDocument>> {
  const response = await bookingConfirmationContainer()
    .item(document.id, document.tenantId)
    .replace<BookingConfirmationDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError(
      "Database update did not return a Booking confirmation.",
      503,
    );
  }
  return { document: response.resource, etag: response.etag };
}
