import "server-only";

import type {
  Container,
  OperationInput,
  PartitionKey,
} from "@azure/cosmos";
import { getCosmosClient } from "./cosmos";
import {
  AUTH_DATABASE_ID,
  StorageError,
  type QueryPage,
  type Versioned,
} from "./auth-storage";
import {
  CHANNEL_IDENTITY_CONTAINER_ID,
  CONVERSATION_CONTAINER_ID,
  type ChannelIdentityDocument,
  type ConversationDocument,
  type MessageDocument,
} from "./conversation-types";

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

export function conversationContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(CONVERSATION_CONTAINER_ID);
}

export function channelIdentityContainer(): Container {
  return getCosmosClient()
    .database(AUTH_DATABASE_ID)
    .container(CHANNEL_IDENTITY_CONTAINER_ID);
}

export function conversationPartitionKey(
  tenantId: string,
  conversationId: string,
): PartitionKey {
  return [tenantId, conversationId];
}

export async function readConversationDocument(
  id: string,
  tenantId: string,
): Promise<Versioned<ConversationDocument> | null> {
  try {
    const response = await conversationContainer()
      .item(id, conversationPartitionKey(tenantId, id))
      .read<ConversationDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function queryConversationPage(
  query: string,
  parameters: { name: string; value: string | number | boolean | null }[],
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<ConversationDocument>> {
  const iterator = conversationContainer().items.query<ConversationDocument>(
    { query, parameters },
    {
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

export async function queryMessagePage(
  tenantId: string,
  conversationId: string,
  continuationToken?: string,
  pageSize = 50,
): Promise<QueryPage<MessageDocument>> {
  const iterator = conversationContainer().items.query<MessageDocument>(
    {
      query:
        "SELECT * FROM c WHERE c.type = @type ORDER BY c.createdAt DESC",
      parameters: [{ name: "@type", value: "message" }],
    },
    {
      partitionKey: conversationPartitionKey(tenantId, conversationId),
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

export async function commitConversationBatch(
  tenantId: string,
  conversationId: string,
  operations: OperationInput[],
): Promise<void> {
  const response = await conversationContainer().items.batch(
    operations,
    conversationPartitionKey(tenantId, conversationId),
  );
  const failed = response.result?.find(
    (operation) =>
      operation.statusCode < 200 || operation.statusCode >= 300,
  );
  const statusCode = response.code ?? 503;
  if (statusCode < 200 || statusCode >= 300 || failed) {
    const status = failed?.statusCode ?? statusCode;
    throw new StorageError(
      status === 409 || status === 412
        ? "The conversation changed. Refresh and retry."
        : "The conversation transaction could not be completed.",
      status === 409 || status === 412 ? 409 : 503,
    );
  }
}

export async function replaceConversationDocument(
  document: ConversationDocument,
  etag: string,
): Promise<Versioned<ConversationDocument>> {
  const response = await conversationContainer()
    .item(
      document.id,
      conversationPartitionKey(document.tenantId, document.conversationId),
    )
    .replace<ConversationDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError(
      "Database update did not return a conversation.",
      503,
    );
  }
  return { document: response.resource, etag: response.etag };
}

export async function readChannelIdentity(
  id: string,
  tenantId: string,
): Promise<Versioned<ChannelIdentityDocument> | null> {
  try {
    const response = await channelIdentityContainer()
      .item(id, tenantId)
      .read<ChannelIdentityDocument>();
    if (!response.resource || !response.etag) return null;
    return { document: response.resource, etag: response.etag };
  } catch (error) {
    if (isStatus(error, 404)) return null;
    throw error;
  }
}

export async function createChannelIdentity(
  document: ChannelIdentityDocument,
): Promise<Versioned<ChannelIdentityDocument>> {
  const response = await channelIdentityContainer().items.create(document);
  if (!response.resource || !response.etag) {
    throw new StorageError(
      "Database write did not return a channel identity.",
      503,
    );
  }
  return { document: response.resource, etag: response.etag };
}

export async function replaceChannelIdentity(
  document: ChannelIdentityDocument,
  etag: string,
): Promise<Versioned<ChannelIdentityDocument>> {
  const response = await channelIdentityContainer()
    .item(document.id, document.tenantId)
    .replace<ChannelIdentityDocument>(document, {
      accessCondition: { type: "IfMatch", condition: etag },
    });
  if (!response.resource || !response.etag) {
    throw new StorageError(
      "Database update did not return a channel identity.",
      503,
    );
  }
  return { document: response.resource, etag: response.etag };
}

export async function deleteChannelIdentity(
  id: string,
  tenantId: string,
  etag: string,
): Promise<void> {
  await channelIdentityContainer().item(id, tenantId).delete({
    accessCondition: { type: "IfMatch", condition: etag },
  });
}
