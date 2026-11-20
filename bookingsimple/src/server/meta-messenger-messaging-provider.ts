import { createHmac } from "node:crypto";
import { z } from "zod";
import { secureEqual } from "./auth-crypto";
import {
  metaAppSecret,
  metaWebhookVerifyToken,
} from "./meta-connection-config";
import {
  metaRouteForTenant,
  metaRoutesForPageIds,
} from "./meta-connection-service";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type ProviderWebhookRequest,
} from "./messaging-provider";

const META_TIMEOUT_MS = 10_000;
const pageIdSchema = z.string().regex(/^\d{5,40}$/);
const psidSchema = z.string().regex(/^\d{5,40}$/);
const metaSendResponseSchema = z.object({
  recipient_id: psidSchema,
  message_id: z.string().trim().min(1).max(200),
});

const metaMessagingEventSchema = z
  .object({
    sender: z.object({ id: psidSchema }).passthrough(),
    recipient: z.object({ id: pageIdSchema }).passthrough(),
    timestamp: z.number().int().positive().max(8_640_000_000_000_000),
    message: z
      .object({
        mid: z.string().trim().min(1).max(200),
        text: z.string().trim().min(1).max(4_000).optional(),
        is_echo: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const metaWebhookSchema = z
  .object({
    object: z.literal("page"),
    entry: z
      .array(
        z
          .object({
            id: pageIdSchema,
            messaging: z.array(metaMessagingEventSchema).max(100).default([]),
          })
          .passthrough(),
      )
      .min(1)
      .max(100),
  })
  .passthrough();

function providerRouteError(
  error: unknown,
  authentication = false,
): MessagingProviderError {
  if (error instanceof MessagingProviderError) return error;
  return new MessagingProviderError(
    authentication
      ? "Meta Messenger webhook authentication failed."
      : "Meta Messenger is not configured.",
    authentication ? "AUTHENTICATION" : "CONFIGURATION",
    authentication ? 401 : 503,
  );
}

function parseWebhook(rawBody: string) {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw new MessagingProviderError(
      "The Meta Messenger webhook payload is invalid.",
      "PAYLOAD",
      400,
    );
  }
  const parsed = metaWebhookSchema.safeParse(value);
  if (!parsed.success) {
    throw new MessagingProviderError(
      "The Meta Messenger webhook payload is invalid.",
      "PAYLOAD",
      400,
    );
  }
  return parsed.data;
}

async function routesForWebhook(rawBody: string) {
  const payload = parseWebhook(rawBody);
  let routes;
  try {
    routes = await metaRoutesForPageIds(
      payload.entry.map((entry) => entry.id),
    );
  } catch (error) {
    throw providerRouteError(error, true);
  }
  return { payload, routes };
}

function validateSignature(
  appSecret: string,
  request: ProviderWebhookRequest,
): void {
  const supplied = request.headers["x-hub-signature-256"]?.trim() ?? "";
  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(request.rawBody)
    .digest("hex")}`;
  if (!supplied || !secureEqual(supplied, expected)) {
    throw new MessagingProviderError(
      "Meta Messenger webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
}

export function verifyMetaWebhookChallenge(
  searchParams: URLSearchParams,
): string {
  const mode = searchParams.get("hub.mode");
  const supplied = searchParams.get("hub.verify_token") ?? "";
  const challenge = searchParams.get("hub.challenge") ?? "";
  const token = metaWebhookVerifyToken();
  const tokenMatches =
    supplied.length > 0 && secureEqual(supplied, token);
  if (
    mode !== "subscribe" ||
    !tokenMatches ||
    challenge.length < 1 ||
    challenge.length > 200
  ) {
    throw new MessagingProviderError(
      "Meta Messenger webhook verification failed.",
      "AUTHENTICATION",
      403,
    );
  }
  return challenge;
}

export const metaMessengerMessagingProvider: MessagingProviderAdapter = {
  provider: "META",
  simulated: false,
  supportedChannels: ["FACEBOOK"],
  async sendMessage(message) {
    let route;
    try {
      route = await metaRouteForTenant(message.tenantId);
    } catch (error) {
      throw providerRouteError(error);
    }
    const recipient = psidSchema.safeParse(message.recipientAddress.trim());
    if (!recipient.success) {
      throw new MessagingProviderError(
        "The Facebook recipient is invalid.",
        "PAYLOAD",
        400,
      );
    }
    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${route.graphApiVersion}/${route.pageId}/messages`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${route.pageAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipient: { id: recipient.data },
            messaging_type: "RESPONSE",
            message: { text: message.body },
          }),
          signal: AbortSignal.timeout(META_TIMEOUT_MS),
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MessagingProviderError(
          "Meta did not respond before the timeout.",
          "TIMEOUT",
          503,
        );
      }
      throw new MessagingProviderError(
        "Meta could not be reached.",
        "PROVIDER",
        503,
      );
    }
    const result: unknown = await response.json().catch(() => null);
    const providerCode =
      result &&
      typeof result === "object" &&
      "error" in result &&
      result.error &&
      typeof result.error === "object" &&
      "code" in result.error &&
      typeof result.error.code === "number"
        ? result.error.code
        : undefined;
    if (!response.ok) {
      throw new MessagingProviderError(
        "Meta did not accept the message.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    const parsed = metaSendResponseSchema.safeParse(result);
    if (!parsed.success || parsed.data.recipient_id !== recipient.data) {
      throw new MessagingProviderError(
        "Meta returned an invalid response.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    return {
      provider: "META",
      externalMessageId: parsed.data.message_id,
      status: "ACCEPTED",
      acceptedAt: new Date().toISOString(),
    };
  },
  async validateWebhook(request) {
    parseWebhook(request.rawBody);
    validateSignature(metaAppSecret(), request);
  },
  async parseIncomingMessage(request) {
    const { payload, routes } = await routesForWebhook(request.rawBody);
    return payload.entry.flatMap((entry, entryIndex) => {
      const route = routes[entryIndex];
      return entry.messaging
        .filter(
          (event) =>
            event.recipient.id === route.pageId &&
            event.sender.id !== route.pageId &&
            event.message?.is_echo !== true &&
            event.message?.text !== undefined,
        )
        .map((event) => ({
          provider: "META" as const,
          tenantId: route.tenantId,
          providerEventId: event.message!.mid,
          externalMessageId: event.message!.mid,
          channel: "FACEBOOK" as const,
          senderAddress: event.sender.id,
          recipientAddress: route.pageId,
          providerRouteKey: route.pageId,
          body: event.message!.text!,
          receivedAt: new Date(event.timestamp).toISOString(),
        }));
    });
  },
};
