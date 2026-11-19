import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { OperationInput } from "@azure/cosmos";
import { randomToken } from "./auth-crypto";
import { StorageError } from "./auth-storage";
import { getCustomer } from "./customer-service";
import { queryCustomerPage } from "./customer-storage";
import type { CustomerDocument, CustomerView } from "./customer-types";
import {
  commitConversationBatch,
  createChannelIdentity,
  deleteChannelIdentity,
  queryChannelIdentitiesByInboundRoute,
  queryConversationPage,
  queryMessagePage,
  readChannelIdentity,
  readConversationDocument,
  readMessageDocument,
  replaceChannelIdentity,
  replaceConversationDocument,
  replaceMessageDocument,
} from "./conversation-storage";
import {
  CONVERSATION_SCHEMA_VERSION,
  type ChannelIdentityDocument,
  type CommunicationChannel,
  type ContactResolution,
  type ConversationDetails,
  type ConversationDocument,
  type ConversationMutationResult,
  type ConversationPage,
  type ConversationView,
  type MessageDocument,
  type MessageDeliveryStatus,
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
import {
  configuredMessagingProvider,
  sendProviderMessage,
} from "./messaging-service";
import {
  MessagingProviderError,
  type NormalizedIncomingMessage,
  type ProviderMessageReceipt,
} from "./messaging-provider";
import { postmarkInboundReplyAddress } from "./postmark-messaging-provider";

const MESSAGE_PREVIEW_LENGTH = 160;

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

function isStatus(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: number;
    status?: number;
    statusCode?: number;
  };
  return (
    candidate.code === status ||
    candidate.status === status ||
    candidate.statusCode === status
  );
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

function assertMessageDocument(
  document: MessageDocument,
  tenantId: string,
  conversationId: string,
): void {
  if (
    document.type !== "message" ||
    document.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    document.tenantId !== tenantId ||
    document.conversationId !== conversationId
  ) {
    throw new StorageError("Message data is invalid.", 503);
  }
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

type InternalMessageInput = {
  body: string;
  direction: "INBOUND" | "OUTBOUND";
  id?: string;
  deliveryStatus?: MessageDeliveryStatus;
  messagingProvider?: string;
  externalMessageId?: string;
  providerEventId?: string;
};

function buildMessage(
  context: TenantContext,
  conversation: ConversationDocument,
  input: InternalMessageInput,
  createdAt: string,
): MessageDocument {
  return {
    id: input.id ?? randomUUID(),
    tenantId: context.tenantId,
    conversationId: conversation.id,
    type: "message",
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    customerId: conversation.customerId,
    direction: input.direction,
    channel: conversation.channel,
    body: input.body,
    deliveryStatus:
      input.deliveryStatus ??
      (input.direction === "INBOUND" ? "RECEIVED" : "LOCAL_ONLY"),
    ...(input.messagingProvider
      ? { messagingProvider: input.messagingProvider }
      : {}),
    ...(input.externalMessageId
      ? { externalMessageId: input.externalMessageId }
      : {}),
    ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
    createdAt,
  };
}

async function appendMessageForContext(
  context: TenantContext,
  conversationId: string,
  input: InternalMessageInput,
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

async function createEmptyConversationDocuments(
  context: TenantContext,
  identity: ChannelIdentityDocument,
  contactLabel: string,
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
    contactLabel,
    channel: identity.channel,
    messageCount: 0,
    lastMessagePreview: "",
    lastMessageDirection: "OUTBOUND",
    lastMessageAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  await commitConversationBatch(context.tenantId, conversation.id, [
    {
      operationType: "Create",
      resourceBody: conversation,
      ifNoneMatch: "*",
    },
  ]);
  return toConversationView(conversation, context);
}

export type EnsureCustomerConversationInput = {
  customerId: string;
  channel: CommunicationChannel;
  normalizedContact: string;
  contactLabel: string;
};

export async function ensureCustomerConversationForContext(
  context: TenantContext,
  input: EnsureCustomerConversationInput,
): Promise<ConversationView> {
  const id = channelIdentityId(input.channel, input.normalizedContact);
  const existingIdentity = await readChannelIdentity(id, context.tenantId);
  if (existingIdentity) {
    assertIdentityDocument(existingIdentity.document, context);
    if (existingIdentity.document.customerId !== input.customerId) {
      throw new StorageError(
        "The selected contact is already associated with another or unresolved Customer.",
        409,
      );
    }
    const existingConversation = await readConversationDocument(
      existingIdentity.document.conversationId,
      context.tenantId,
    );
    if (existingConversation) {
      assertConversationDocument(existingConversation.document, context);
      if (existingConversation.document.customerId !== input.customerId) {
        throw new StorageError(
          "The selected Conversation belongs to another Customer.",
          409,
        );
      }
      return toConversationView(existingConversation.document, context);
    }
    return createEmptyConversationDocuments(
      context,
      existingIdentity.document,
      input.contactLabel,
    );
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
    customerId: input.customerId,
    createdAt: now,
    updatedAt: now,
  };
  let createdIdentity;
  try {
    createdIdentity = await createChannelIdentity(provisionalIdentity);
  } catch (error) {
    if (isStatus(error, 409)) {
      return ensureCustomerConversationForContext(context, input);
    }
    throw error;
  }
  try {
    return await createEmptyConversationDocuments(
      context,
      createdIdentity.document,
      input.contactLabel,
    );
  } catch (error) {
    try {
      await deleteChannelIdentity(
        createdIdentity.document.id,
        context.tenantId,
        createdIdentity.etag,
      );
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          event: "empty-conversation-identity-rollback-failed",
          tenantId: context.tenantId,
          identityId: createdIdentity.document.id,
          error:
            cleanupError instanceof Error
              ? cleanupError.name
              : "UnknownError",
        }),
      );
    }
    throw error;
  }
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
  return addConversationMessageForContext(
    await contextForRequest(request),
    conversationId,
    input,
  );
}

export async function addConversationMessageForContext(
  context: TenantContext,
  conversationId: string,
  input: CreateMessageInput,
): Promise<{ conversation: ConversationView; message: MessageView }> {
  const existing = await existingMessageMutation(
    context,
    conversationId,
    input,
  );
  if (existing) return existing;

  const provider = configuredMessagingProvider();
  if (provider.simulated) {
    return appendMessageForContext(context, conversationId, {
      id: input.requestId,
      body: input.body,
      direction: "OUTBOUND",
      deliveryStatus: "LOCAL_ONLY",
    });
  }

  const storedConversation = await requiredConversation(context, conversationId);
  if (storedConversation.document.channel !== "EMAIL") {
    throw new StorageError(
      "The configured messaging provider supports Email Conversations only.",
      409,
    );
  }
  const identity = await requiredIdentity(
    context,
    storedConversation.document.channelIdentityId,
    conversationId,
  );
  const routedIdentity = await ensureInboundRoute(context, identity);
  const pending = await appendMessageForContext(context, conversationId, {
    id: input.requestId,
    body: input.body,
    direction: "OUTBOUND",
    deliveryStatus: "PENDING",
    messagingProvider: provider.provider,
  });
  const storedMessage = await readMessageDocument(
    input.requestId,
    context.tenantId,
    conversationId,
  );
  if (!storedMessage) {
    throw new StorageError("The pending Message could not be loaded.", 503);
  }
  const attemptedAt = new Date().toISOString();

  let receipt: ProviderMessageReceipt;
  try {
    receipt = await sendProviderMessage(provider, {
      tenantId: context.tenantId,
      conversationId,
      messageId: input.requestId,
      channel: "EMAIL",
      recipientAddress: routedIdentity.document.normalizedAddress,
      subject: `Message from ${context.businessName}`.slice(0, 200),
      replyAddress: postmarkInboundReplyAddress(
        routedIdentity.document.inboundRouteKey!,
      ),
      body: input.body,
      requestedAt: storedMessage.document.createdAt,
    });
  } catch (error) {
    const failureCategory =
      error instanceof MessagingProviderError ? error.category : "UNKNOWN";
    try {
      await replaceMessageDocument(
        {
          ...storedMessage.document,
          deliveryStatus: "FAILED",
          failureCategory,
          providerAttemptedAt: attemptedAt,
        },
        storedMessage.etag,
      );
    } catch {
      console.error(
        JSON.stringify({
          event: "conversation-message-failure-state-write-failed",
          tenantId: context.tenantId,
          conversationId,
          messageId: input.requestId,
        }),
      );
    }
    logOutboundFailure(context, conversationId, input.requestId, error);
    throw new StorageError(
      "The Email could not be sent. The failed attempt remains visible in the Conversation.",
      502,
    );
  }
  let sent;
  try {
    sent = await replaceMessageDocument(
      {
        ...storedMessage.document,
        deliveryStatus: "SENT",
        messagingProvider: receipt.provider,
        externalMessageId: receipt.externalMessageId,
        providerAttemptedAt: attemptedAt,
        sentAt: receipt.acceptedAt,
      },
      storedMessage.etag,
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "conversation-message-acceptance-write-failed",
        tenantId: context.tenantId,
        conversationId,
        messageId: input.requestId,
        provider: receipt.provider,
        externalMessageId: receipt.externalMessageId,
      }),
    );
    throw new StorageError(
      "The Email provider accepted the message, but its status could not be reconciled.",
      503,
    );
  }
  return {
    conversation: pending.conversation,
    message: toMessageView(sent.document, context, conversationId),
  };
}

async function existingMessageMutation(
  context: TenantContext,
  conversationId: string,
  input: CreateMessageInput,
): Promise<{ conversation: ConversationView; message: MessageView } | null> {
  const existing = await readMessageDocument(
    input.requestId,
    context.tenantId,
    conversationId,
  );
  if (!existing) return null;
  assertMessageDocument(existing.document, context.tenantId, conversationId);
  if (
    existing.document.direction !== "OUTBOUND" ||
    existing.document.body !== input.body
  ) {
    throw new StorageError(
      "The message request identifier is already in use.",
      409,
    );
  }
  const conversation = await requiredConversation(context, conversationId);
  return {
    conversation: toConversationView(conversation.document, context),
    message: toMessageView(existing.document, context, conversationId),
  };
}

async function ensureInboundRoute(
  context: TenantContext,
  stored: Awaited<ReturnType<typeof requiredIdentity>>,
) {
  if (stored.document.inboundRouteKey) return stored;
  const updated: ChannelIdentityDocument = {
    ...stored.document,
    inboundRouteKey: randomToken(32),
    updatedAt: new Date().toISOString(),
  };
  try {
    return await replaceChannelIdentity(updated, stored.etag);
  } catch (error) {
    if (!isStatus(error, 409) && !isStatus(error, 412)) throw error;
    const current = await requiredIdentity(
      context,
      stored.document.id,
      stored.document.conversationId,
    );
    if (!current.document.inboundRouteKey) {
      throw new StorageError(
        "The Conversation reply route changed. Refresh and retry.",
        409,
      );
    }
    return current;
  }
}

function logOutboundFailure(
  context: TenantContext,
  conversationId: string,
  messageId: string,
  error: unknown,
): void {
  const details: Record<string, string | number> = {
    event: "conversation-message-delivery-failed",
    tenantId: context.tenantId,
    conversationId,
    messageId,
    category:
      error instanceof MessagingProviderError ? error.category : "UNKNOWN",
  };
  if (error instanceof MessagingProviderError) {
    if (error.providerStatus !== undefined) {
      details.providerStatus = error.providerStatus;
    }
    if (error.providerCode !== undefined) {
      details.providerCode = error.providerCode;
    }
  }
  console.error(JSON.stringify(details));
}

export type IncomingMessageOutcome = {
  status: "PROCESSED" | "DUPLICATE" | "IGNORED";
  conversationId?: string;
  messageId?: string;
};

export async function processIncomingProviderMessage(
  incoming: NormalizedIncomingMessage,
): Promise<IncomingMessageOutcome> {
  const identities = await queryChannelIdentitiesByInboundRoute(
    incoming.providerRouteKey,
  );
  const routeDigest = createHash("sha256")
    .update(incoming.providerRouteKey)
    .digest("hex");
  if (identities.length === 0) {
    console.warn(
      JSON.stringify({
        event: "conversation-inbound-route-not-found",
        provider: incoming.provider,
        routeDigest,
      }),
    );
    return { status: "IGNORED" };
  }
  if (identities.length !== 1) {
    console.error(
      JSON.stringify({
        event: "conversation-inbound-route-ambiguous",
        provider: incoming.provider,
        routeDigest,
      }),
    );
    throw new StorageError("The inbound Conversation route is ambiguous.", 503);
  }
  const identity = identities[0];
  if (
    identity.type !== "channel-identity" ||
    identity.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    identity.channel !== incoming.channel ||
    identity.inboundRouteKey !== incoming.providerRouteKey
  ) {
    throw new StorageError("Channel identity data is invalid.", 503);
  }
  if (identity.normalizedAddress !== incoming.senderAddress) {
    console.warn(
      JSON.stringify({
        event: "conversation-inbound-sender-mismatch",
        provider: incoming.provider,
        tenantId: identity.tenantId,
        conversationId: identity.conversationId,
      }),
    );
    return { status: "IGNORED" };
  }
  const storedConversation = await readConversationDocument(
    identity.conversationId,
    identity.tenantId,
  );
  if (!storedConversation) {
    throw new StorageError("Conversation data is unavailable.", 503);
  }
  if (
    storedConversation.document.type !== "conversation" ||
    storedConversation.document.schemaVersion !== CONVERSATION_SCHEMA_VERSION ||
    storedConversation.document.tenantId !== identity.tenantId ||
    storedConversation.document.channelIdentityId !== identity.id ||
    storedConversation.document.channel !== incoming.channel
  ) {
    throw new StorageError("Conversation data is invalid.", 503);
  }
  const messageId = `provider_${createHash("sha256")
    .update(`${incoming.provider}\n${incoming.externalMessageId}`)
    .digest("hex")}`;
  const duplicate = await readMessageDocument(
    messageId,
    identity.tenantId,
    identity.conversationId,
  );
  if (duplicate) {
    assertMessageDocument(
      duplicate.document,
      identity.tenantId,
      identity.conversationId,
    );
    return {
      status: "DUPLICATE",
      conversationId: identity.conversationId,
      messageId,
    };
  }
  const message: MessageDocument = {
    id: messageId,
    tenantId: identity.tenantId,
    conversationId: identity.conversationId,
    type: "message",
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    customerId: storedConversation.document.customerId,
    direction: "INBOUND",
    channel: incoming.channel,
    body: incoming.body,
    deliveryStatus: "RECEIVED",
    messagingProvider: incoming.provider,
    externalMessageId: incoming.externalMessageId,
    providerEventId: incoming.providerEventId,
    createdAt: incoming.receivedAt,
  };
  const incomingIsLatest =
    Date.parse(incoming.receivedAt) >=
    Date.parse(storedConversation.document.lastMessageAt);
  const updated: ConversationDocument = {
    ...storedConversation.document,
    messageCount: storedConversation.document.messageCount + 1,
    ...(incomingIsLatest
      ? {
          lastMessagePreview: messagePreview(incoming.body),
          lastMessageDirection: "INBOUND" as const,
          lastMessageAt: incoming.receivedAt,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  try {
    await commitConversationBatch(identity.tenantId, identity.conversationId, [
      {
        operationType: "Create",
        resourceBody: message,
        ifNoneMatch: "*",
      },
      {
        operationType: "Replace",
        id: updated.id,
        resourceBody: updated,
        ifMatch: storedConversation.etag,
      },
    ]);
  } catch (error) {
    if (isStatus(error, 409)) {
      const raced = await readMessageDocument(
        messageId,
        identity.tenantId,
        identity.conversationId,
      );
      if (raced) {
        return {
          status: "DUPLICATE",
          conversationId: identity.conversationId,
          messageId,
        };
      }
    }
    throw error;
  }
  return {
    status: "PROCESSED",
    conversationId: identity.conversationId,
    messageId,
  };
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
