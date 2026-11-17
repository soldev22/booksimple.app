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
  CUSTOMER_CONTAINER_ID,
  type CustomerDocument,
} from "./customer-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function customerContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(CUSTOMER_CONTAINER_ID);
}

export async function readCustomerDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<CustomerDocument> | null> {
  try {
    const response = await customerContainer()
      .item(id, tenantId)
      .read<CustomerDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createCustomerDocument(
  document: CustomerDocument,
): Promise<Versioned<CustomerDocument>> {
  const response = await customerContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a customer.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceCustomerDocument(
  document: CustomerDocument,
  etag: string,
): Promise<Versioned<CustomerDocument>> {
  const response = await customerContainer()
    .item(document.id, document.tenantId)
    .replace<CustomerDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a customer.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function queryCustomerPage<T>(
  tenantId: string,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<T>> {
  const iterator = customerContainer().items.query<T>(
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
