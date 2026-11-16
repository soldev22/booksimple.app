import "server-only";

import type {
  Container,
  ItemDefinition,
  OperationInput,
} from "@azure/cosmos";
import { getCosmosClient } from "./cosmos";
import { sha256 } from "./auth-crypto";

export const AUTH_DATABASE_ID = "booksimple";
export const AUTH_CONTROL_CONTAINER_ID = "auth-control";
export const AUTH_SESSIONS_CONTAINER_ID = "auth-sessions";
export const AUTH_THROTTLES_CONTAINER_ID = "auth-throttles";

export type AuthDocument = ItemDefinition & {
  id: string;
  partitionKey: string;
  type: string;
  schemaVersion: 1;
  ttl?: number;
};

export type Versioned<T> = {
  document: T;
  etag: string;
};

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function isConflict(error: unknown): boolean {
  return isStatus(error, 409) || isStatus(error, 412);
}

export function isPreconditionFailed(error: unknown): boolean {
  return isStatus(error, 412);
}

export function controlContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(AUTH_CONTROL_CONTAINER_ID);
}

export function sessionContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(AUTH_SESSIONS_CONTAINER_ID);
}

export function throttleContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(AUTH_THROTTLES_CONTAINER_ID);
}

export async function readDocument<T extends AuthDocument>(
  container: Container,
  id: string,
  partitionKey: string,
): Promise<Versioned<T> | null> {
  try {
    const response = await container.item(id, partitionKey).read<T>();
    if (!response.resource || !response.etag) {
      return null;
    }
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) {
      return null;
    }
    throw error;
  }
}

export async function createDocument<T extends AuthDocument>(
  container: Container,
  document: T,
): Promise<Versioned<T>> {
  const response = await container.items.create<T>(document);
  if (!response.resource || !response.etag) {
    throw new StorageError("Database write did not return a document.", 503);
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceDocument<T extends AuthDocument>(
  container: Container,
  document: T,
  etag: string,
): Promise<Versioned<T>> {
  const response = await container
    .item(document.id, document.partitionKey)
    .replace<T>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError("Database update did not return a document.", 503);
  }
  return { document: response.resource as T, etag: response.etag };
}

export async function deleteDocument(
  container: Container,
  id: string,
  partitionKey: string,
  etag?: string,
): Promise<void> {
  await container.item(id, partitionKey).delete(
    etag
      ? { accessCondition: { type: "IfMatch", condition: etag } }
      : undefined,
  );
}

export async function commitBatch(
  container: Container,
  partitionKey: string,
  operations: OperationInput[],
): Promise<void> {
  const response = await container.items.batch(operations, partitionKey);
  const failed = response.result?.find(
    (operation) =>
      operation.statusCode < 200 || operation.statusCode >= 300,
  );
  const statusCode = response.code ?? 503;
  if (statusCode < 200 || statusCode >= 300 || failed) {
    const status = failed?.statusCode ?? statusCode;
    throw new StorageError(
      status === 409 || status === 412
        ? "A conflicting record already exists."
        : "The database transaction could not be completed.",
      status === 409 || status === 412 ? 409 : 503,
    );
  }
}

export type QueryPage<T> = {
  items: T[];
  continuationToken?: string;
};

export async function queryPage<T>(
  container: Container,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<T>> {
  const iterator = container.items.query<T>(
    { query, parameters },
    {
      maxItemCount: pageSize,
      continuationToken,
    },
  );
  const page = await iterator.fetchNext();
  return {
    items: page.resources,
    continuationToken: page.continuationToken,
  };
}

export async function queryAllPages<T>(
  container: Container,
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  pageSize = 100,
  maxItems = 10_000,
): Promise<T[]> {
  const results: T[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await queryPage<T>(
      container,
      query,
      parameters,
      continuationToken,
      Math.min(pageSize, maxItems - results.length),
    );
    results.push(...page.items);
    continuationToken = page.continuationToken;
  } while (continuationToken && results.length < maxItems);
  if (continuationToken) {
    throw new StorageError("The database result exceeded the safe limit.", 503);
  }
  return results;
}

export async function consumeRateLimit(
  scope: string,
  key: string,
  maximum: number,
  windowSeconds: number,
  now = Date.now(),
): Promise<void> {
  const container = throttleContainer();
  const keyHash = `${scope}_${sha256(`${scope}\n${key}`)}`;
  const id = keyHash;
  const partitionKey = keyHash;
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds;
  const windowEnd = windowStart + windowSeconds;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readDocument<RateLimitDocument>(
      container,
      id,
      partitionKey,
    );
    const inWindow =
      current !== null && current.document.windowStart === windowStart;
    const count = inWindow ? current.document.count : 0;
    if (count >= maximum) {
      throw new StorageError("Too many requests. Please try again later.", 429);
    }
    const next: RateLimitDocument = {
      id,
      partitionKey,
      type: "rate-limit",
      schemaVersion: 1,
      windowStart,
      count: count + 1,
      ttl: Math.max(1, windowEnd - Math.floor(now / 1000) + 2),
    };

    try {
      if (!current) {
        await createDocument(container, next);
      } else {
        await replaceDocument(container, next, current.etag);
      }
      return;
    } catch (error) {
      if (isConflict(error) || isPreconditionFailed(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new StorageError("Rate limiting is temporarily unavailable.", 503);
}

type RateLimitDocument = AuthDocument & {
  type: "rate-limit";
  windowStart: number;
  count: number;
};
