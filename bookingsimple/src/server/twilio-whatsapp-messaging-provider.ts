import { z } from "zod";
import { normalizePhone } from "./customer-validation";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type ProviderWebhookRequest,
} from "./messaging-provider";
import {
  sendTwilioMessage,
  twilioRouteForTenant,
  validateTwilioWebhookSignature,
} from "./twilio-sms-messaging-provider";

const twilioSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const twilioMessageSidSchema = z.string().regex(/^(?:SM|MM)[a-fA-F0-9]{32}$/);
const e164Schema = z.string().regex(/^\+\d{7,15}$/);
const whatsappAddressSchema = z
  .string()
  .regex(/^whatsapp:\+\d{7,15}$/);

const whatsappSenderSchema = z
  .object({
    tenantId: z.uuid(),
    fromNumber: e164Schema,
  })
  .strict();

type WhatsAppSender = z.infer<typeof whatsappSenderSchema>;

const twilioWhatsAppInboundSchema = z.object({
  AccountSid: twilioSidSchema,
  MessageSid: twilioMessageSidSchema,
  From: whatsappAddressSchema,
  To: whatsappAddressSchema,
  Body: z.string().trim().min(1).max(4_000),
});

function configurationError(): MessagingProviderError {
  return new MessagingProviderError(
    "Twilio WhatsApp messaging is not configured.",
    "CONFIGURATION",
    503,
  );
}

function configuredSenders(): WhatsAppSender[] {
  const raw = process.env.TWILIO_WHATSAPP_SENDERS?.trim();
  if (!raw) throw configurationError();
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw configurationError();
  }
  const parsed = z.array(whatsappSenderSchema).min(1).max(100).safeParse(value);
  if (!parsed.success) throw configurationError();
  const tenants = new Set<string>();
  const senders = new Set<string>();
  for (const sender of parsed.data) {
    if (tenants.has(sender.tenantId) || senders.has(sender.fromNumber)) {
      throw configurationError();
    }
    tenants.add(sender.tenantId);
    senders.add(sender.fromNumber);
  }
  return parsed.data;
}

function senderForTenant(tenantId: string): WhatsAppSender {
  const sender = configuredSenders().find((item) => item.tenantId === tenantId);
  if (!sender) throw configurationError();
  return sender;
}

function webhookParameters(rawBody: string): URLSearchParams {
  const parameters = new URLSearchParams(rawBody);
  if (parameters.size === 0) {
    throw new MessagingProviderError(
      "The Twilio WhatsApp inbound payload is invalid.",
      "PAYLOAD",
      400,
    );
  }
  return parameters;
}

function bareWhatsAppNumber(value: string): string {
  if (!value.startsWith("whatsapp:")) return "";
  return normalizePhone(value.slice("whatsapp:".length));
}

function inboundSender(parameters: URLSearchParams) {
  const destination = bareWhatsAppNumber(parameters.get("To") ?? "");
  const sender = configuredSenders().find(
    (item) => item.fromNumber === destination,
  );
  if (!sender) {
    throw new MessagingProviderError(
      "Twilio webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
  const route = twilioRouteForTenant(sender.tenantId);
  if (route.accountSid !== parameters.get("AccountSid")) {
    throw new MessagingProviderError(
      "Twilio webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
  return { route, sender };
}

function parsedInbound(parameters: URLSearchParams) {
  return twilioWhatsAppInboundSchema.safeParse({
    AccountSid: parameters.get("AccountSid"),
    MessageSid: parameters.get("MessageSid"),
    From: parameters.get("From"),
    To: parameters.get("To"),
    Body: parameters.get("Body"),
  });
}

export const twilioWhatsAppMessagingProvider: MessagingProviderAdapter = {
  provider: "TWILIO",
  simulated: false,
  supportedChannels: ["WHATSAPP"],
  async sendMessage(message) {
    const sender = senderForTenant(message.tenantId);
    const route = twilioRouteForTenant(message.tenantId);
    const recipient = e164Schema.safeParse(
      normalizePhone(message.recipientAddress),
    );
    if (!recipient.success) {
      throw new MessagingProviderError(
        "The WhatsApp recipient is invalid.",
        "PAYLOAD",
        400,
      );
    }
    return sendTwilioMessage(
      route,
      `whatsapp:${sender.fromNumber}`,
      `whatsapp:${recipient.data}`,
      message.body,
    );
  },
  async validateWebhook(request: ProviderWebhookRequest) {
    const parameters = webhookParameters(request.rawBody);
    const { route } = inboundSender(parameters);
    validateTwilioWebhookSignature(route, request, parameters);
  },
  async parseIncomingMessage(request: ProviderWebhookRequest) {
    const parameters = webhookParameters(request.rawBody);
    const { sender } = inboundSender(parameters);
    const parsed = parsedInbound(parameters);
    if (!parsed.success) {
      throw new MessagingProviderError(
        "The Twilio WhatsApp inbound payload is invalid.",
        "PAYLOAD",
        400,
      );
    }
    const senderAddress = bareWhatsAppNumber(parsed.data.From);
    const recipientAddress = bareWhatsAppNumber(parsed.data.To);
    return [
      {
        provider: "TWILIO",
        tenantId: sender.tenantId,
        providerEventId: parsed.data.MessageSid,
        externalMessageId: parsed.data.MessageSid,
        channel: "WHATSAPP",
        senderAddress,
        recipientAddress,
        providerRouteKey: recipientAddress,
        body: parsed.data.Body,
        receivedAt: new Date().toISOString(),
      },
    ];
  },
};
