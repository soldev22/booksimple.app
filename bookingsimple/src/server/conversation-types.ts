import type { ItemDefinition } from "@azure/cosmos";
import type { CustomerView } from "./customer-types";

export const CONVERSATION_SCHEMA_VERSION = 1;
export const CONVERSATION_CONTAINER_ID = "conversations";
export const CHANNEL_IDENTITY_CONTAINER_ID = "channel-identities";

export const COMMUNICATION_CHANNELS = [
  "WHATSAPP",
  "FACEBOOK",
  "SMS",
  "EMAIL",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageDeliveryStatus = "RECEIVED" | "LOCAL_ONLY";

export type ConversationDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  conversationId: string;
  type: "conversation";
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  channelIdentityId: string;
  customerId?: string;
  contactLabel: string;
  channel: CommunicationChannel;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  conversationId: string;
  type: "message";
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  customerId?: string;
  direction: MessageDirection;
  channel: CommunicationChannel;
  body: string;
  deliveryStatus: MessageDeliveryStatus;
  messagingProvider?: string;
  externalMessageId?: string;
  providerEventId?: string;
  createdAt: string;
};

export type ChannelIdentityDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "channel-identity";
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  channel: CommunicationChannel;
  normalizedAddress: string;
  displayLabel: string;
  conversationId: string;
  customerId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationView = {
  id: string;
  customerId?: string;
  channel: CommunicationChannel;
  contactLabel: string;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageView = {
  id: string;
  direction: MessageDirection;
  channel: CommunicationChannel;
  body: string;
  deliveryStatus: MessageDeliveryStatus;
  createdAt: string;
};

export type ContactResolution = {
  status: "matched" | "ambiguous" | "unmatched";
  normalizedAddress: string;
  displayLabel: string;
  candidates: CustomerView[];
};

export type ConversationDetails = {
  conversation: ConversationView;
  messages: MessageView[];
  resolution: ContactResolution;
  messageContinuationToken?: string;
};

export type ConversationPage = {
  conversations: ConversationView[];
  continuationToken?: string;
};

export type ConversationMutationResult = {
  conversation: ConversationView;
  created: boolean;
  resolution: ContactResolution;
};
