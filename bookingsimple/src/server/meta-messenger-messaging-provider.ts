import { createHmac } from "node:crypto";
import { z } from "zod";
import { secureEqual } from "./auth-crypto";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type ProviderWebhookRequest,
} from "./messaging-provider";

const META_TIMEOUT_MS = 10_000;
const pageIdSchema = z.string().regex(/^\d{5,40}$/);
const psidSchema = z.string().regex(/^\d{5,40}$/);
const graphApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const secretSchema = z.string().min(16).max(4_096).regex(/^\S+$/);

const metaRouteSchema = z
  .object({
    tenantId: z.uuid(),
    pageId: pageIdSchema,
    pageAccessToken: secretSchema,
    appSecret: secretSchema,
    verifyToken: secretSchema,
    graphApiVersion: graphApiVersionSchema,
  })
  .strict();

type MetaRoute = z.infer<typeof metaRouteSchema>;

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

function configurationError(): MessagingProviderError {
  return new MessagingProviderError(
    "Meta Messenger is not configured.",
    "CONFIGURATION",
    503,
  );
}

function configuredRoutes(): MetaRoute[] {
  const raw = process.env.META_MESSENGER_ROUTES?.trim();
  if (!raw) throw configurationError();
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw configurationError();
  }
  const parsed = z.array(metaRouteSchema).min(1).max(100).safeParse(value);
  if (!parsed.success) throw configurationError();
  const tenants = new Set<string>();
  const pages = new Set<string>();
  for (const route of parsed.data) {
    if (tenants.has(route.tenantId) || pages.has(route.pageId)) {
      throw configurationError();
    }
    tenants.add(route.tenantId);
    pages.add(route.pageId);
  }
  return parsed.data;
}

function routeForTenant(tenantId: string): MetaRoute {
  const route = configuredRoutes().find((item) => item.tenantId === tenantId);
  if (!route) throw configurationError();
  return route;
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

function routesForWebhook(rawBody: string) {
  const payload = parseWebhook(rawBody);
  const configured = configuredRoutes();
  const routes = payload.entry.map((entry) =>
    configured.find((route) => route.pageId === entry.id),
  );
  if (routes.some((route) => !route)) {
    throw new MessagingProviderError(
      "Meta Messenger webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
  const resolved = routes as MetaRoute[];
  if (
    resolved.some(
      (route) => !secureEqual(route.appSecret, resolved[0].appSecret),
    )
  ) {
    throw new MessagingProviderError(
      "Meta Messenger webhook authentication failed.",
      "AUTHENTICATION",
      401,
    );
  }
  return { payload, routes: resolved };
}

function validateSignature(
  route: MetaRoute,
  request: ProviderWebhookRequest,
): void {
  const supplied = request.headers["x-hub-signature-256"]?.trim() ?? "";
  const expected = `sha256=${createHmac("sha256", route.appSecret)
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
  const tokens = [
    ...new Set(configuredRoutes().map((route) => route.verifyToken)),
  ];
  const tokenMatches = tokens.some(
    (token) => supplied.length > 0 && secureEqual(supplied, token),
  );
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
    const route = routeForTenant(message.tenantId);
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
    const { routes } = routesForWebhook(request.rawBody);
    validateSignature(routes[0], request);
  },
  async parseIncomingMessage(request) {
    const { payload, routes } = routesForWebhook(request.rawBody);
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
