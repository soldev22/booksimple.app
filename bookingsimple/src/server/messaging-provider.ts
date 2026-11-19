import type { CommunicationChannel } from "./conversation-types";

export type MessagingProviderName =
  | "MOCK_TEST"
  | "POSTMARK"
  | "TWILIO"
  | "META";
export type ProviderMessageStatus = "ACCEPTED";
export type MessagingProviderErrorCategory =
  | "AUTHENTICATION"
  | "CONFIGURATION"
  | "PAYLOAD"
  | "PROVIDER"
  | "TIMEOUT";

export class MessagingProviderError extends Error {
  constructor(
    message: string,
    readonly category: MessagingProviderErrorCategory,
    readonly status: number,
    readonly providerStatus?: number,
    readonly providerCode?: number,
  ) {
    super(message);
    this.name = "MessagingProviderError";
  }
}

export type ProviderWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
  url?: string;
};

export type OutboundProviderMessage = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  channel: CommunicationChannel;
  recipientAddress: string;
  subject: string;
  replyAddress?: string;
  body: string;
  requestedAt: string;
};

export type ProviderMessageReceipt = {
  provider: MessagingProviderName;
  externalMessageId: string;
  status: ProviderMessageStatus;
  acceptedAt: string;
};

export type NormalizedIncomingMessage = {
  provider: MessagingProviderName;
  tenantId?: string;
  providerEventId: string;
  externalMessageId: string;
  channel: CommunicationChannel;
  senderAddress: string;
  recipientAddress: string;
  providerRouteKey: string;
  body: string;
  receivedAt: string;
};

export interface MessagingProviderAdapter {
  readonly provider: MessagingProviderName;
  readonly simulated: boolean;
  readonly supportedChannels: readonly CommunicationChannel[];
  sendMessage(
    message: OutboundProviderMessage,
  ): Promise<ProviderMessageReceipt>;
  validateWebhook(request: ProviderWebhookRequest): Promise<void>;
  parseIncomingMessage(
    request: ProviderWebhookRequest,
  ): Promise<NormalizedIncomingMessage[]>;
}
