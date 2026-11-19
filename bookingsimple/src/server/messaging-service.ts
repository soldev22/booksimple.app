import "server-only";

import { z } from "zod";
import { COMMUNICATION_CHANNELS } from "./conversation-types";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type NormalizedIncomingMessage,
  type OutboundProviderMessage,
  type ProviderMessageReceipt,
  type ProviderWebhookRequest,
} from "./messaging-provider";
import { mockMessagingProvider } from "./mock-messaging-provider";
import { postmarkMessagingProvider } from "./postmark-messaging-provider";
import { twilioSmsMessagingProvider } from "./twilio-sms-messaging-provider";

const outboundMessageSchema = z
  .object({
    tenantId: z.uuid(),
    conversationId: z.uuid(),
    messageId: z.uuid(),
    channel: z.enum(COMMUNICATION_CHANNELS),
    recipientAddress: z.string().trim().min(1).max(254),
    subject: z.string().trim().min(1).max(200),
    replyAddress: z.email().max(254).optional(),
    body: z.string().trim().min(1).max(4_000),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const messageReceiptSchema = z
  .object({
    provider: z.enum(["MOCK_TEST", "POSTMARK", "TWILIO"]),
    externalMessageId: z.string().trim().min(1).max(200),
    status: z.literal("ACCEPTED"),
    acceptedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const normalizedIncomingSchema = z
  .object({
    provider: z.enum(["MOCK_TEST", "POSTMARK", "TWILIO"]),
    tenantId: z.uuid().optional(),
    providerEventId: z.string().trim().min(1).max(200),
    externalMessageId: z.string().trim().min(1).max(200),
    channel: z.enum(COMMUNICATION_CHANNELS),
    senderAddress: z.string().trim().min(1).max(254),
    recipientAddress: z.string().trim().min(1).max(254),
    providerRouteKey: z.string().trim().min(1).max(254),
    body: z.string().trim().min(1).max(4_000),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function configuredMessagingProvider(): MessagingProviderAdapter {
  const configured =
    process.env.MESSAGING_PROVIDER?.trim().toUpperCase() || "MOCK_TEST";
  if (configured === "MOCK_TEST") return mockMessagingProvider;
  if (configured === "POSTMARK") return postmarkMessagingProvider;
  throw new Error("The messaging provider configuration is invalid.");
}

export function messagingProviderForChannel(
  channel: (typeof COMMUNICATION_CHANNELS)[number],
): MessagingProviderAdapter {
  const configured = configuredMessagingProvider();
  if (configured.simulated) return configured;
  if (channel === "SMS") return twilioSmsMessagingProvider;
  return configured;
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
  if (Buffer.byteLength(request.rawBody, "utf8") > 1_000_000) {
    throw new MessagingProviderError(
      "The messaging webhook payload is too large.",
      "PAYLOAD",
      413,
    );
  }
  await provider.validateWebhook(request);
  return z
    .array(normalizedIncomingSchema)
    .min(1)
    .max(100)
    .parse(await provider.parseIncomingMessage(request));
}
