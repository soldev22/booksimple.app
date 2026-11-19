import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
} from "./conversation-types";
import { normalizePhone } from "./customer-validation";
import type {
  MessagingProviderAdapter,
  ProviderWebhookRequest,
} from "./messaging-provider";

const mockIncomingSchema = z
  .object({
    eventId: z.string().trim().min(1).max(200),
    message: z
      .object({
        id: z.string().trim().min(1).max(200),
        channel: z.enum(COMMUNICATION_CHANNELS),
        senderAddress: z.string().trim().min(1).max(254),
        recipientAddress: z.string().trim().min(1).max(254),
        body: z.string().trim().min(1).max(4_000),
        receivedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

function normalizedAddress(
  channel: CommunicationChannel,
  address: string,
): string {
  if (channel === "EMAIL") {
    const email = z.email().max(254).parse(address.trim().toLowerCase());
    return email;
  }
  if (channel === "SMS" || channel === "WHATSAPP") {
    const phone = normalizePhone(address);
    if (!/^\+?\d{7,15}$/.test(phone)) {
      throw new Error("The mock provider phone address is invalid.");
    }
    return phone;
  }
  return address.trim();
}

function webhookSignature(request: ProviderWebhookRequest): string {
  return request.headers["x-booksimple-mock-signature"]?.trim() ?? "";
}

export const mockMessagingProvider: MessagingProviderAdapter = {
  provider: "MOCK_TEST",
  simulated: true,
  supportedChannels: COMMUNICATION_CHANNELS,
  async sendMessage(message) {
    return {
      provider: "MOCK_TEST",
      externalMessageId: `mock_msg_${message.messageId}`,
      status: "ACCEPTED",
      acceptedAt: message.requestedAt,
    };
  },
  async validateWebhook(request) {
    const supplied = Buffer.from(webhookSignature(request), "hex");
    const expected = createHash("sha256").update(request.rawBody).digest();
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new Error("The mock messaging webhook signature is invalid.");
    }
  },
  async parseIncomingMessage(request) {
    const input = mockIncomingSchema.parse(JSON.parse(request.rawBody));
    return [
      {
        provider: "MOCK_TEST",
        providerEventId: input.eventId,
        externalMessageId: input.message.id,
        channel: input.message.channel,
        senderAddress: normalizedAddress(
          input.message.channel,
          input.message.senderAddress,
        ),
        recipientAddress: normalizedAddress(
          input.message.channel,
          input.message.recipientAddress,
        ),
        providerRouteKey: normalizedAddress(
          input.message.channel,
          input.message.recipientAddress,
        ),
        body: input.message.body,
        receivedAt: new Date(input.message.receivedAt).toISOString(),
      },
    ];
  },
};
