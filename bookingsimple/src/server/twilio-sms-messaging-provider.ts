import { createHmac } from "node:crypto";
import { z } from "zod";
import { secureEqual } from "./auth-crypto";
import { normalizePhone } from "./customer-validation";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type ProviderWebhookRequest,
} from "./messaging-provider";

const TWILIO_TIMEOUT_MS = 8_000;
const twilioSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const twilioMessageSidSchema = z.string().regex(/^(?:SM|MM)[a-fA-F0-9]{32}$/);
const e164Schema = z.string().regex(/^\+\d{7,15}$/);

const twilioRouteSchema = z
  .object({
    tenantId: z.uuid(),
    accountSid: twilioSidSchema,
    authToken: z.string().min(1).max(200),
    fromNumber: e164Schema,
  })
  .strict();

type TwilioSmsRoute = z.infer<typeof twilioRouteSchema>;

const twilioSendResponseSchema = z.object({
  sid: twilioMessageSidSchema,
  status: z.string().trim().min(1).max(50),
});

const twilioInboundSchema = z.object({
  AccountSid: twilioSidSchema,
  MessageSid: twilioMessageSidSchema,
  From: e164Schema,
  To: e164Schema,
  Body: z.string().trim().min(1).max(4_000),
});

function configurationError(): MessagingProviderError {
  return new MessagingProviderError(
    "Twilio SMS messaging is not configured.",
    "CONFIGURATION",
    503,
  );
}

function configuredRoutes(): TwilioSmsRoute[] {
  const raw = process.env.TWILIO_SMS_ROUTES?.trim();
  if (!raw) throw configurationError();
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw configurationError();
  }
  const parsed = z.array(twilioRouteSchema).min(1).max(100).safeParse(value);
  if (!parsed.success) throw configurationError();
  const tenants = new Set<string>();
  const destinations = new Set<string>();
  for (const route of parsed.data) {
    const destination = `${route.accountSid}\n${route.fromNumber}`;
    if (tenants.has(route.tenantId) || destinations.has(destination)) {
      throw configurationError();
    }
    tenants.add(route.tenantId);
    destinations.add(destination);
  }
  return parsed.data;
}

function outboundRoute(tenantId: string): TwilioSmsRoute {
  const route = configuredRoutes().find((item) => item.tenantId === tenantId);
  if (!route) throw configurationError();
  return route;
}

function webhookParameters(rawBody: string): URLSearchParams {
  const parameters = new URLSearchParams(rawBody);
  if (parameters.size === 0) {
    throw new MessagingProviderError(
      "The Twilio inbound payload is invalid.",
      "PAYLOAD",
      400,
    );
  }
  return parameters;
}

function inboundRoute(parameters: URLSearchParams): TwilioSmsRoute {
  const accountSid = parameters.get("AccountSid");
  const to = normalizePhone(parameters.get("To") ?? "");
  const route = configuredRoutes().find(
    (item) => item.accountSid === accountSid && item.fromNumber === to,
  );
  if (!route) {
    throw new MessagingProviderError(
      "Twilio webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
  return route;
}

function webhookUrl(request: ProviderWebhookRequest): string {
  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin || !request.url) throw configurationError();
  let configured: URL;
  let received: URL;
  try {
    configured = new URL(origin);
    received = new URL(request.url);
  } catch {
    throw configurationError();
  }
  if (configured.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw configurationError();
  }
  return new URL(
    `${received.pathname}${received.search}`,
    configured.origin,
  ).toString();
}

function expectedWebhookSignature(
  route: TwilioSmsRoute,
  request: ProviderWebhookRequest,
  parameters: URLSearchParams,
): string {
  const sorted = Array.from(parameters.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const value = sorted.reduce(
    (result, [name, parameter]) => `${result}${name}${parameter}`,
    webhookUrl(request),
  );
  return createHmac("sha1", route.authToken).update(value).digest("base64");
}

function basicAuthorization(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function normalizedInboundPayload(parameters: URLSearchParams) {
  return {
    AccountSid: parameters.get("AccountSid"),
    MessageSid: parameters.get("MessageSid"),
    From: normalizePhone(parameters.get("From") ?? ""),
    To: normalizePhone(parameters.get("To") ?? ""),
    Body: parameters.get("Body"),
  };
}

export const twilioSmsMessagingProvider: MessagingProviderAdapter = {
  provider: "TWILIO",
  simulated: false,
  supportedChannels: ["SMS"],
  async sendMessage(message) {
    const route = outboundRoute(message.tenantId);
    const recipient = e164Schema.safeParse(normalizePhone(message.recipientAddress));
    if (!recipient.success) {
      throw new MessagingProviderError(
        "The SMS recipient is invalid.",
        "PAYLOAD",
        400,
      );
    }
    const body = new URLSearchParams({
      Body: message.body,
      From: route.fromNumber,
      To: recipient.data,
    });
    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${route.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: basicAuthorization(
              route.accountSid,
              route.authToken,
            ),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
          signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MessagingProviderError(
          "Twilio did not respond before the timeout.",
          "TIMEOUT",
          503,
        );
      }
      throw new MessagingProviderError(
        "Twilio could not be reached.",
        "PROVIDER",
        503,
      );
    }
    const result: unknown = await response.json().catch(() => null);
    const providerCode =
      result &&
      typeof result === "object" &&
      "code" in result &&
      typeof result.code === "number" &&
      Number.isInteger(result.code)
        ? result.code
        : undefined;
    if (!response.ok) {
      throw new MessagingProviderError(
        "Twilio did not accept the message.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    const parsed = twilioSendResponseSchema.safeParse(result);
    if (!parsed.success) {
      throw new MessagingProviderError(
        "Twilio returned an invalid response.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    return {
      provider: "TWILIO",
      externalMessageId: parsed.data.sid,
      status: "ACCEPTED",
      acceptedAt: new Date().toISOString(),
    };
  },
  async validateWebhook(request) {
    const parameters = webhookParameters(request.rawBody);
    const route = inboundRoute(parameters);
    const supplied = request.headers["x-twilio-signature"]?.trim() ?? "";
    const expected = expectedWebhookSignature(route, request, parameters);
    if (!supplied || !secureEqual(supplied, expected)) {
      throw new MessagingProviderError(
        "Twilio webhook authentication failed.",
        "AUTHENTICATION",
        401,
      );
    }
  },
  async parseIncomingMessage(request) {
    const parameters = webhookParameters(request.rawBody);
    const route = inboundRoute(parameters);
    const parsed = twilioInboundSchema.safeParse(
      normalizedInboundPayload(parameters),
    );
    if (!parsed.success) {
      throw new MessagingProviderError(
        "The Twilio inbound payload is invalid.",
        "PAYLOAD",
        400,
      );
    }
    return [
      {
        provider: "TWILIO",
        tenantId: route.tenantId,
        providerEventId: parsed.data.MessageSid,
        externalMessageId: parsed.data.MessageSid,
        channel: "SMS",
        senderAddress: parsed.data.From,
        recipientAddress: parsed.data.To,
        providerRouteKey: parsed.data.To,
        body: parsed.data.Body,
        receivedAt: new Date().toISOString(),
      },
    ];
  },
};
