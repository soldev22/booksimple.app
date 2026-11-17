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
  SERVICE_CONTAINER_ID,
  type ServiceDocument,
} from "./service-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function serviceContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(SERVICE_CONTAINER_ID);
}

export async function readServiceDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<ServiceDocument> | null> {
  try {
    const response = await serviceContainer()
      .item(id, tenantId)
      .read<ServiceDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createServiceDocument(
  document: ServiceDocument,
): Promise<Versioned<ServiceDocument>> {
  const response = await serviceContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a service.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceServiceDocument(
  document: ServiceDocument,
  etag: string,
): Promise<Versioned<ServiceDocument>> {
  const response = await serviceContainer()
    .item(document.id, document.tenantId)
    .replace<ServiceDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a service.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function queryServicePage(
  tenantId: string,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<ServiceDocument>> {
  const iterator = serviceContainer().items.query<ServiceDocument>(
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
