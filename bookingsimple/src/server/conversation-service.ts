import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { OperationInput } from "@azure/cosmos";
import { StorageError } from "./auth-storage";
import { getCustomer } from "./customer-service";
import { queryCustomerPage } from "./customer-storage";
import type { CustomerDocument, CustomerView } from "./customer-types";
import {
  commitConversationBatch,
  createChannelIdentity,
  deleteChannelIdentity,
  queryConversationPage,
  queryMessagePage,
  readChannelIdentity,
  readConversationDocument,
  replaceChannelIdentity,
  replaceConversationDocument,
} from "./conversation-storage";
import {
  CONVERSATION_SCHEMA_VERSION,
  type ChannelIdentityDocument,
  type ContactResolution,
  type ConversationDetails,
  type ConversationDocument,
  type ConversationMutationResult,
  type ConversationPage,
  type ConversationView,
  type MessageDocument,
  type MessageView,
} from "./conversation-types";
import type {
  ConversationListInput,
  CreateConversationInput,
  CreateMessageInput,
  MessageListInput,
} from "./conversation-validation";
import type { TenantContext } from "./auth-types";
import { getRequestViewer } from "./auth";
import { requireTenantContext } from "./tenant-context";

const MESSAGE_PREVIEW_LENGTH = 160;

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: number; statusCode?: number };
  return candidate.code === status || candidate.statusCode === status;
}

function assertConversationDocument(
  document: ConversationDocument,
  context: TenantContext,
): void {
  if (
    document.type !== "conversation" ||
    document.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    document.tenantId !== context.tenantId ||
    document.conversationId !== document.id
  ) {
    throw new StorageError("Conversation data is invalid.", 503);
  }
}

function assertIdentityDocument(
  document: ChannelIdentityDocument,
  context: TenantContext,
  conversationId?: string,
): void {
  if (
    document.type !== "channel-identity" ||
    document.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    document.tenantId !== context.tenantId ||
    (conversationId && document.conversationId !== conversationId)
  ) {
    throw new StorageError("Channel identity data is invalid.", 503);
  }
}

function toConversationView(
  document: ConversationDocument,
  context: TenantContext,
): ConversationView {
  assertConversationDocument(document, context);
  return {
    id: document.id,
    customerId: document.customerId,
    channel: document.channel,
    contactLabel: document.contactLabel,
    messageCount: document.messageCount,
    lastMessagePreview: document.lastMessagePreview,
    lastMessageDirection: document.lastMessageDirection,
    lastMessageAt: document.lastMessageAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toMessageView(
  document: MessageDocument,
  context: TenantContext,
  conversationId: string,
): MessageView {
  if (
    document.type !== "message" ||
    document.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    document.tenantId !== context.tenantId ||
    document.conversationId !== conversationId
  ) {
    throw new StorageError("Message data is invalid.", 503);
  }
  return {
    id: document.id,
    direction: document.direction,
    channel: document.channel,
    body: document.body,
    deliveryStatus: document.deliveryStatus,
    createdAt: document.createdAt,
  };
}

function channelIdentityId(channel: string, normalizedAddress: string): string {
  const digest = createHash("sha256")
    .update(`${channel}\n${normalizedAddress}`)
    .digest("hex");
  return `identity_${digest}`;
}

function messagePreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, MESSAGE_PREVIEW_LENGTH);
}

function matchingInput(identity: ChannelIdentityDocument): {
  normalizedEmail?: string;
  normalizedPhone?: string;
} {
  if (identity.channel === "EMAIL") {
    return { normalizedEmail: identity.normalizedAddress };
  }
  if (identity.channel === "SMS" || identity.channel === "WHATSAPP") {
    return { normalizedPhone: identity.normalizedAddress };
  }
  return {};
}

async function exactMatches(
  context: TenantContext,
  identity: ChannelIdentityDocument,
): Promise<CustomerView[]> {
  const input = matchingInput(identity);
  const predicates: string[] = [];
  const parameters: { name: string; value: string }[] = [
    { name: "@type", value: "customer" },
    { name: "@status", value: "active" },
  ];
  if (input.normalizedEmail) {
    predicates.push("c.email = @email");
    parameters.push({ name: "@email", value: input.normalizedEmail });
  }
  if (input.normalizedPhone) {
    predicates.push("c.phone = @phone");
    parameters.push({ name: "@phone", value: input.normalizedPhone });
  }
  if (predicates.length === 0) return [];

  const result = await queryCustomerPage<CustomerDocument>(
    context.tenantId,
    `SELECT TOP 11 * FROM c
     WHERE c.type = @type
       AND c.status = @status
       AND (${predicates.join(" OR ")})`,
    parameters,
    undefined,
    11,
  );
  return result.items.map((customer) => ({
    id: customer.id,
    name: customer.status === "erased" ? "Erased customer" : customer.name,
    ...(customer.status !== "erased" && customer.email
      ? { email: customer.email }
      : {}),
    ...(customer.status !== "erased" && customer.phone
      ? { phone: customer.phone }
      : {}),
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  }));
}

async function resolutionForIdentity(
  context: TenantContext,
  identity: ChannelIdentityDocument,
  knownCandidates?: CustomerView[],
): Promise<ContactResolution> {
  assertIdentityDocument(identity, context);
  if (identity.customerId) {
    return {
      status: "matched",
      normalizedAddress: identity.normalizedAddress,
      displayLabel: identity.displayLabel,
      candidates: [],
    };
  }
  const candidates =
    knownCandidates ?? (await exactMatches(context, identity));
  return {
    status: candidates.length > 1 ? "ambiguous" : "unmatched",
    normalizedAddress: identity.normalizedAddress,
    displayLabel: identity.displayLabel,
    candidates,
  };
}

async function requiredConversation(
  context: TenantContext,
  conversationId: string,
) {
  const stored = await readConversationDocument(
    conversationId,
    context.tenantId,
  );
  if (!stored) throw new StorageError("Conversation not found.", 404);
  assertConversationDocument(stored.document, context);
  return stored;
}

async function requiredIdentity(
  context: TenantContext,
  identityId: string,
  conversationId: string,
) {
  const stored = await readChannelIdentity(identityId, context.tenantId);
  if (!stored) throw new StorageError("Channel identity not found.", 503);
  assertIdentityDocument(stored.document, context, conversationId);
  return stored;
}

function buildMessage(
  context: TenantContext,
  conversation: ConversationDocument,
  input: CreateMessageInput,
  createdAt: string,
): MessageDocument {
  return {
    id: randomUUID(),
    tenantId: context.tenantId,
    conversationId: conversation.id,
    type: "message",
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    customerId: conversation.customerId,
    direction: input.direction,
    channel: conversation.channel,
    body: input.body,
    deliveryStatus:
      input.direction === "INBOUND" ? "RECEIVED" : "LOCAL_ONLY",
    createdAt,
  };
}

async function appendMessageForContext(
  context: TenantContext,
  conversationId: string,
  input: CreateMessageInput,
): Promise<{ conversation: ConversationView; message: MessageView }> {
  const stored = await requiredConversation(context, conversationId);
  const createdAt = new Date().toISOString();
  const message = buildMessage(context, stored.document, input, createdAt);
  const updated: ConversationDocument = {
    ...stored.document,
    messageCount: stored.document.messageCount + 1,
    lastMessagePreview: messagePreview(input.body),
    lastMessageDirection: input.direction,
    lastMessageAt: createdAt,
    updatedAt: createdAt,
  };
  const operations: OperationInput[] = [
    {
      operationType: "Create",
      resourceBody: message,
      ifNoneMatch: "*",
    },
    {
      operationType: "Replace",
      id: updated.id,
      resourceBody: updated,
      ifMatch: stored.etag,
    },
  ];
  await commitConversationBatch(
    context.tenantId,
    conversationId,
    operations,
  );
  return {
    conversation: toConversationView(updated, context),
    message: toMessageView(message, context, conversationId),
  };
}

async function createConversationDocuments(
  context: TenantContext,
  identity: ChannelIdentityDocument,
  input: CreateConversationInput,
): Promise<ConversationView> {
  const createdAt = new Date().toISOString();
  const conversation: ConversationDocument = {
    id: identity.conversationId,
    tenantId: context.tenantId,
    conversationId: identity.conversationId,
    type: "conversation",
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    channelIdentityId: identity.id,
    customerId: identity.customerId,
    contactLabel: input.contactLabel,
    channel: input.channel,
    messageCount: 1,
    lastMessagePreview: messagePreview(input.initialMessage),
    lastMessageDirection: input.direction,
    lastMessageAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  const message = buildMessage(
    context,
    conversation,
    { body: input.initialMessage, direction: input.direction },
    createdAt,
  );
  await commitConversationBatch(context.tenantId, conversation.id, [
    {
      operationType: "Create",
      resourceBody: conversation,
      ifNoneMatch: "*",
    },
    {
      operationType: "Create",
      resourceBody: message,
      ifNoneMatch: "*",
    },
  ]);
  return toConversationView(conversation, context);
}

export async function listConversationsForContext(
  context: TenantContext,
  input: ConversationListInput,
): Promise<ConversationPage> {
  const parameters: {
    name: string;
    value: string | number | boolean | null;
  }[] = [
    { name: "@tenantId", value: context.tenantId },
    { name: "@type", value: "conversation" },
  ];
  let searchClause = "";
  if (input.search) {
    searchClause = ` AND (
      CONTAINS(LOWER(c.contactLabel), @search)
      OR CONTAINS(LOWER(c.lastMessagePreview), @search)
      OR CONTAINS(LOWER(c.channel), @search)
    )`;
    parameters.push({
      name: "@search",
      value: input.search.toLowerCase(),
    });
  }
  const page = await queryConversationPage(
    `SELECT * FROM c
     WHERE c.tenantId = @tenantId
       AND c.type = @type${searchClause}
     ORDER BY c.lastMessageAt DESC`,
    parameters,
    input.continuationToken,
    input.pageSize,
  );
  return {
    conversations: page.items.map((document) =>
      toConversationView(document, context),
    ),
    continuationToken: page.continuationToken,
  };
}

export async function listConversations(
  request: Request,
  input: ConversationListInput,
): Promise<ConversationPage> {
  return listConversationsForContext(await contextForRequest(request), input);
}

export async function createConversation(
  request: Request,
  input: CreateConversationInput,
): Promise<ConversationMutationResult> {
  const context = await contextForRequest(request);
  const id = channelIdentityId(input.channel, input.normalizedContact);
  const existingIdentity = await readChannelIdentity(id, context.tenantId);

  if (existingIdentity) {
    assertIdentityDocument(existingIdentity.document, context);
    const existingConversation = await readConversationDocument(
      existingIdentity.document.conversationId,
      context.tenantId,
    );
    if (existingConversation) {
      const appended = await appendMessageForContext(
        context,
        existingIdentity.document.conversationId,
        { body: input.initialMessage, direction: input.direction },
      );
      return {
        conversation: appended.conversation,
        created: false,
        resolution: await resolutionForIdentity(
          context,
          existingIdentity.document,
        ),
      };
    }

    const repaired = await createConversationDocuments(
      context,
      existingIdentity.document,
      input,
    );
    return {
      conversation: repaired,
      created: true,
      resolution: await resolutionForIdentity(
        context,
        existingIdentity.document,
      ),
    };
  }

  const now = new Date().toISOString();
  const provisionalIdentity: ChannelIdentityDocument = {
    id,
    tenantId: context.tenantId,
    type: "channel-identity",
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    channel: input.channel,
    normalizedAddress: input.normalizedContact,
    displayLabel: input.contactLabel,
    conversationId: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const candidates = await exactMatches(context, provisionalIdentity);
  if (candidates.length === 1) {
    provisionalIdentity.customerId = candidates[0].id;
  }

  let createdIdentity;
  try {
    createdIdentity = await createChannelIdentity(provisionalIdentity);
  } catch (error) {
    if (isStatus(error, 409)) {
      const racedIdentity = await readChannelIdentity(id, context.tenantId);
      if (!racedIdentity) {
        throw new StorageError(
          "Channel identity changed. Refresh and retry.",
          409,
        );
      }
      assertIdentityDocument(racedIdentity.document, context);
      const appended = await appendMessageForContext(
        context,
        racedIdentity.document.conversationId,
        { body: input.initialMessage, direction: input.direction },
      );
      return {
        conversation: appended.conversation,
        created: false,
        resolution: await resolutionForIdentity(
          context,
          racedIdentity.document,
        ),
      };
    }
    throw error;
  }

  try {
    const conversation = await createConversationDocuments(
      context,
      createdIdentity.document,
      input,
    );
    return {
      conversation,
      created: true,
      resolution: await resolutionForIdentity(
        context,
        createdIdentity.document,
        candidates,
      ),
    };
  } catch (error) {
    try {
      await deleteChannelIdentity(
        createdIdentity.document.id,
        context.tenantId,
        createdIdentity.etag,
      );
    } catch (cleanupError) {
      console.error("Failed to remove an orphaned channel identity.", {
        identityId: createdIdentity.document.id,
        tenantId: context.tenantId,
        cleanupError,
      });
    }
    throw error;
  }
}

export async function getConversationDetailsForContext(
  context: TenantContext,
  conversationId: string,
  input: MessageListInput,
): Promise<ConversationDetails> {
  const stored = await requiredConversation(context, conversationId);
  const identity = await requiredIdentity(
    context,
    stored.document.channelIdentityId,
    conversationId,
  );
  const page = await queryMessagePage(
    context.tenantId,
    conversationId,
    input.messageContinuationToken,
    input.messagePageSize,
  );
  const messages = page.items
    .map((document) => toMessageView(document, context, conversationId))
    .reverse();
  return {
    conversation: toConversationView(stored.document, context),
    messages,
    resolution: await resolutionForIdentity(context, identity.document),
    messageContinuationToken: page.continuationToken,
  };
}

export async function getConversationDetails(
  request: Request,
  conversationId: string,
  input: MessageListInput,
): Promise<ConversationDetails> {
  return getConversationDetailsForContext(
    await contextForRequest(request),
    conversationId,
    input,
  );
}

export async function addConversationMessage(
  request: Request,
  conversationId: string,
  input: CreateMessageInput,
): Promise<{ conversation: ConversationView; message: MessageView }> {
  return appendMessageForContext(
    await contextForRequest(request),
    conversationId,
    input,
  );
}

export async function linkConversationCustomer(
  request: Request,
  conversationId: string,
  customerId: string,
): Promise<ConversationView> {
  const context = await contextForRequest(request);
  const [storedConversation, customer] = await Promise.all([
    requiredConversation(context, conversationId),
    getCustomer(context, customerId),
  ]);
  if (customer.status !== "active") {
    throw new StorageError(
      "Only an active Customer can be linked to a Conversation.",
      409,
    );
  }
  if (storedConversation.document.customerId === customerId) {
    return toConversationView(storedConversation.document, context);
  }
  const storedIdentity = await requiredIdentity(
    context,
    storedConversation.document.channelIdentityId,
    conversationId,
  );
  const updatedAt = new Date().toISOString();
  const previousIdentity = storedIdentity.document;
  const updatedIdentity: ChannelIdentityDocument = {
    ...previousIdentity,
    customerId,
    updatedAt,
  };
  const replacedIdentity = await replaceChannelIdentity(
    updatedIdentity,
    storedIdentity.etag,
  );
  const updatedConversation: ConversationDocument = {
    ...storedConversation.document,
    customerId,
    updatedAt,
  };
  try {
    const replacedConversation = await replaceConversationDocument(
      updatedConversation,
      storedConversation.etag,
    );
    return toConversationView(replacedConversation.document, context);
  } catch (error) {
    try {
      await replaceChannelIdentity(
        previousIdentity,
        replacedIdentity.etag,
      );
    } catch (rollbackError) {
      console.error("Failed to roll back a channel identity link.", {
        identityId: previousIdentity.id,
        tenantId: context.tenantId,
        rollbackError,
      });
      throw new StorageError(
        "Customer linking is inconsistent and requires support.",
        503,
      );
    }
    throw error;
  }
}
