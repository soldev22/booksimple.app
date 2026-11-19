import type { CommunicationChannel } from "./conversation-types";

export type MessagingProviderName = "MOCK_TEST";
export type ProviderMessageStatus = "ACCEPTED";

export type ProviderWebhookRequest = {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
};

export type OutboundProviderMessage = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  channel: CommunicationChannel;
  recipientAddress: string;
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
  providerEventId: string;
  externalMessageId: string;
  channel: CommunicationChannel;
  senderAddress: string;
  recipientAddress: string;
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
