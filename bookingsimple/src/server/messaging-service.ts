import "server-only";

import { z } from "zod";
import { COMMUNICATION_CHANNELS } from "./conversation-types";
import type {
  MessagingProviderAdapter,
  NormalizedIncomingMessage,
  OutboundProviderMessage,
  ProviderMessageReceipt,
  ProviderWebhookRequest,
} from "./messaging-provider";
import { mockMessagingProvider } from "./mock-messaging-provider";

const outboundMessageSchema = z
  .object({
    tenantId: z.uuid(),
    conversationId: z.uuid(),
    messageId: z.uuid(),
    channel: z.enum(COMMUNICATION_CHANNELS),
    recipientAddress: z.string().trim().min(1).max(254),
    body: z.string().trim().min(1).max(4_000),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const messageReceiptSchema = z
  .object({
    provider: z.literal("MOCK_TEST"),
    externalMessageId: z.string().trim().min(1).max(200),
    status: z.literal("ACCEPTED"),
    acceptedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const normalizedIncomingSchema = z
  .object({
    provider: z.literal("MOCK_TEST"),
    providerEventId: z.string().trim().min(1).max(200),
    externalMessageId: z.string().trim().min(1).max(200),
    channel: z.enum(COMMUNICATION_CHANNELS),
    senderAddress: z.string().trim().min(1).max(254),
    recipientAddress: z.string().trim().min(1).max(254),
    body: z.string().trim().min(1).max(4_000),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function configuredMessagingProvider(): MessagingProviderAdapter {
  const configured =
    process.env.MESSAGING_PROVIDER?.trim().toUpperCase() || "MOCK_TEST";
  if (configured === "MOCK_TEST") return mockMessagingProvider;
  throw new Error("The messaging provider configuration is invalid.");
}

export async function sendProviderMessage(
  provider: MessagingProviderAdapter,
  input: OutboundProviderMessage,
): Promise<ProviderMessageReceipt> {
  const message = outboundMessageSchema.parse(input);
  if (!provider.supportedChannels.includes(message.channel)) {
    throw new Error(
      `The configured messaging provider does not support ${message.channel}.`,
    );
  }
  return messageReceiptSchema.parse(await provider.sendMessage(message));
}

export async function parseProviderWebhook(
  provider: MessagingProviderAdapter,
  request: ProviderWebhookRequest,
): Promise<NormalizedIncomingMessage[]> {
  if (Buffer.byteLength(request.rawBody, "utf8") > 256_000) {
    throw new Error("The messaging webhook payload is too large.");
  }
  await provider.validateWebhook(request);
  return z
    .array(normalizedIncomingSchema)
    .min(1)
    .max(100)
    .parse(await provider.parseIncomingMessage(request));
}
