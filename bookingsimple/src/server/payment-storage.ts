import "server-only";

import type { Container } from "@azure/cosmos";
import { getCosmosClient } from "./cosmos";
import {
  AUTH_DATABASE_ID,
  StorageError,
  type Versioned,
} from "./auth-storage";
import {
  PAYMENT_CONTAINER_ID,
  type PaymentDocument,
} from "./payment-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function paymentContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(PAYMENT_CONTAINER_ID);
}

export async function readPaymentDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<PaymentDocument> | null> {
  try {
    const response = await paymentContainer()
      .item(id, tenantId)
      .read<PaymentDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createPaymentDocument(
  document: PaymentDocument,
): Promise<Versioned<PaymentDocument>> {
  const response = await paymentContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a Payment.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replacePaymentDocument(
  document: PaymentDocument,
  etag: string,
): Promise<Versioned<PaymentDocument>> {
  const response = await paymentContainer()
    .item(document.id, document.tenantId)
    .replace<PaymentDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a Payment.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function queryBookingPayments(
  tenantId: string,
  bookingId: string,
): Promise<PaymentDocument[]> {
  const response = await paymentContainer().items
    .query<PaymentDocument>(
      {
        query:
          "SELECT * FROM c WHERE c.type = @type AND c.bookingId = @bookingId ORDER BY c.createdAt ASC",
        parameters: [
          { name: "@type", value: "payment" },
          { name: "@bookingId", value: bookingId },
        ],
      },
      { partitionKey: tenantId, maxItemCount: 20 },
    )
    .fetchNext();
  if (response.continuationToken) {
    throw new StorageError(
      "The Booking has more Payment records than the supported limit.",
      503,
    );
  }
  return response.resources;
}
