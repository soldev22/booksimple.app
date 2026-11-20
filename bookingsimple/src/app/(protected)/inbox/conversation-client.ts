import type {
  ContactResolution,
  ConversationDetails,
  ConversationMutationResult,
  ConversationPage,
  ConversationView,
  MessageView,
} from "@/server/conversation-types";
import { isCustomer } from "../customers/customer-client";

function isChannel(value: unknown): boolean {
  return ["WHATSAPP", "FACEBOOK", "SMS", "EMAIL"].includes(String(value));
}

function isDirection(value: unknown): boolean {
  return value === "INBOUND" || value === "OUTBOUND";
}

function isConversation(value: unknown): value is ConversationView {
  const archiveValues =
    typeof value === "object" && value !== null
      ? [
          "archivedAt" in value ? value.archivedAt : undefined,
          "archivedByUserId" in value ? value.archivedByUserId : undefined,
          "archivedByUsername" in value
            ? value.archivedByUsername
            : undefined,
        ]
      : [];
  const archiveFieldsValid =
    archiveValues.every((item) => item === undefined) ||
    archiveValues.every((item) => typeof item === "string");
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    (!("customerId" in value) || typeof value.customerId === "string") &&
    "channel" in value &&
    isChannel(value.channel) &&
    "contactLabel" in value &&
    typeof value.contactLabel === "string" &&
    "messageCount" in value &&
    typeof value.messageCount === "number" &&
    "lastMessagePreview" in value &&
    typeof value.lastMessagePreview === "string" &&
    "lastMessageDirection" in value &&
    isDirection(value.lastMessageDirection) &&
    "lastMessageAt" in value &&
    typeof value.lastMessageAt === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    archiveFieldsValid
  );
}

export function parseConversationArchiveMutation(
  value: unknown,
): ConversationView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversation" in value) ||
    !isConversation(value.conversation)
  ) {
    throw new Error("The server returned invalid Conversation data.");
  }
  return value.conversation;
}

function isMessage(value: unknown): value is MessageView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "direction" in value &&
    isDirection(value.direction) &&
    "channel" in value &&
    isChannel(value.channel) &&
    "body" in value &&
    typeof value.body === "string" &&
    "deliveryStatus" in value &&
    ["RECEIVED", "LOCAL_ONLY", "PENDING", "SENT", "FAILED"].includes(
      String(value.deliveryStatus),
    ) &&
    "createdAt" in value &&
    typeof value.createdAt === "string"
  );
}

function isResolution(value: unknown): value is ContactResolution {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    ["matched", "ambiguous", "unmatched"].includes(String(value.status)) &&
    "normalizedAddress" in value &&
    typeof value.normalizedAddress === "string" &&
    "displayLabel" in value &&
    typeof value.displayLabel === "string" &&
    "candidates" in value &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isCustomer)
  );
}

function optionalToken(value: object): string | undefined {
  if (!("continuationToken" in value)) return undefined;
  const token = value.continuationToken;
  if (token !== undefined && typeof token !== "string") {
    throw new Error("The server returned invalid Conversation data.");
  }
  return token;
}

export function parseConversationPage(value: unknown): ConversationPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversations" in value) ||
    !Array.isArray(value.conversations) ||
    !value.conversations.every(isConversation)
  ) {
    throw new Error("The server returned invalid Conversation data.");
  }
  const continuationToken = optionalToken(value);
  return {
    conversations: value.conversations,
    ...(continuationToken ? { continuationToken } : {}),
  };
}

export function parseConversationMutation(
  value: unknown,
): ConversationMutationResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversation" in value) ||
    !isConversation(value.conversation) ||
    !("created" in value) ||
    typeof value.created !== "boolean" ||
    !("resolution" in value) ||
    !isResolution(value.resolution)
  ) {
    throw new Error("The server returned invalid Conversation data.");
  }
  return {
    conversation: value.conversation,
    created: value.created,
    resolution: value.resolution,
  };
}

export function parseConversationDetails(value: unknown): ConversationDetails {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversation" in value) ||
    !isConversation(value.conversation) ||
    !("messages" in value) ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isMessage) ||
    !("resolution" in value) ||
    !isResolution(value.resolution)
  ) {
    throw new Error("The server returned invalid Conversation data.");
  }
  const token =
    "messageContinuationToken" in value
      ? value.messageContinuationToken
      : undefined;
  if (token !== undefined && typeof token !== "string") {
    throw new Error("The server returned invalid Conversation data.");
  }
  return {
    conversation: value.conversation,
    messages: value.messages,
    resolution: value.resolution,
    ...(token ? { messageContinuationToken: token } : {}),
  };
}

export function parseMessageMutation(value: unknown): {
  conversation: ConversationView;
  message: MessageView;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversation" in value) ||
    !isConversation(value.conversation) ||
    !("message" in value) ||
    !isMessage(value.message)
  ) {
    throw new Error("The server returned invalid Conversation data.");
  }
  return { conversation: value.conversation, message: value.message };
}

export async function conversationApi(
  endpoint: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "The Conversation request could not be completed.",
    );
  }
  return result;
}
