import { z } from "zod";
import { secureEqual } from "./auth-crypto";
import {
  MessagingProviderError,
  type MessagingProviderAdapter,
  type ProviderWebhookRequest,
} from "./messaging-provider";

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";
const POSTMARK_TIMEOUT_MS = 8_000;
const routeKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const postmarkSendResponseSchema = z.object({
  ErrorCode: z.number().int(),
  MessageID: z.string().trim().min(1).max(200),
  SubmittedAt: z.iso.datetime({ offset: true }),
});

const postmarkAddressSchema = z.object({
  Email: z.email().max(254),
});

const postmarkInboundSchema = z.object({
  MessageID: z.string().trim().min(1).max(200),
  FromFull: postmarkAddressSchema,
  ToFull: z.array(postmarkAddressSchema).min(1).max(100),
  MailboxHash: routeKeySchema,
  Date: z.string().trim().min(1).max(100),
  TextBody: z.string().max(100_000),
  StrippedTextReply: z.string().max(100_000).optional().default(""),
});

function configuredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MessagingProviderError(
      "Postmark messaging is not configured.",
      "CONFIGURATION",
      503,
    );
  }
  return value;
}

function postmarkFromAddress(): string {
  const value = configuredValue("POSTMARK_FROM_EMAIL");
  if (!z.email().max(254).safeParse(value).success) {
    throw new MessagingProviderError(
      "Postmark messaging is not configured.",
      "CONFIGURATION",
      503,
    );
  }
  return value;
}

function decodeBasicCredentials(
  request: ProviderWebhookRequest,
): { username: string; password: string } | null {
  const authorization = request.headers.authorization?.trim() ?? "";
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function normalizedEmail(value: string): string {
  return z.email().max(254).parse(value.trim().toLowerCase());
}

function normalizedReceivedAt(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new MessagingProviderError(
      "The Postmark inbound payload is invalid.",
      "PAYLOAD",
      400,
    );
  }
  return timestamp.toISOString();
}

function inboundBody(strippedReply: string, textBody: string): string {
  const body = (strippedReply.trim() || textBody.trim()).slice(0, 4_001);
  if (!body || body.length > 4_000) {
    throw new MessagingProviderError(
      "The Postmark inbound message body is invalid.",
      "PAYLOAD",
      400,
    );
  }
  return body;
}

export function postmarkInboundReplyAddress(routeKey: string): string {
  const route = routeKeySchema.parse(routeKey);
  const configured = configuredValue("POSTMARK_INBOUND_ADDRESS").toLowerCase();
  const parsed = z.email().max(254).safeParse(configured);
  if (!parsed.success) {
    throw new MessagingProviderError(
      "Postmark inbound messaging is not configured.",
      "CONFIGURATION",
      503,
    );
  }
  const separator = configured.lastIndexOf("@");
  const localPart = configured.slice(0, separator).split("+", 1)[0];
  const domain = configured.slice(separator + 1);
  const replyAddress = `${localPart}+${route}@${domain}`;
  if (!z.email().max(254).safeParse(replyAddress).success) {
    throw new MessagingProviderError(
      "Postmark inbound messaging is not configured.",
      "CONFIGURATION",
      503,
    );
  }
  return replyAddress;
}

export const postmarkMessagingProvider: MessagingProviderAdapter = {
  provider: "POSTMARK",
  simulated: false,
  supportedChannels: ["EMAIL"],
  async sendMessage(message) {
    const token = configuredValue("POSTMARK_SERVER_TOKEN");
    let response: Response;
    try {
      response = await fetch(POSTMARK_SEND_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify({
          From: postmarkFromAddress(),
          To: message.recipientAddress,
          ReplyTo: message.replyAddress,
          Subject: message.subject,
          TextBody: message.body,
          MessageStream:
            process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
          Tag: "conversation-message",
          Metadata: { messageId: message.messageId },
        }),
        signal: AbortSignal.timeout(POSTMARK_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new MessagingProviderError(
          "Postmark did not respond before the timeout.",
          "TIMEOUT",
          503,
        );
      }
      throw new MessagingProviderError(
        "Postmark could not be reached.",
        "PROVIDER",
        503,
      );
    }

    const result: unknown = await response.json().catch(() => null);
    const providerCode =
      result &&
      typeof result === "object" &&
      "ErrorCode" in result &&
      typeof result.ErrorCode === "number" &&
      Number.isInteger(result.ErrorCode)
        ? result.ErrorCode
        : undefined;
    if (!response.ok || providerCode !== 0) {
      throw new MessagingProviderError(
        "Postmark did not accept the message.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    const parsed = postmarkSendResponseSchema.safeParse(result);
    if (!parsed.success) {
      throw new MessagingProviderError(
        "Postmark returned an invalid response.",
        "PROVIDER",
        502,
        response.status,
        providerCode,
      );
    }
    return {
      provider: "POSTMARK",
      externalMessageId: parsed.data.MessageID,
      status: "ACCEPTED",
      acceptedAt: new Date(parsed.data.SubmittedAt).toISOString(),
    };
  },
  async validateWebhook(request) {
    const expectedUsername = configuredValue(
      "POSTMARK_INBOUND_WEBHOOK_USERNAME",
    );
    const expectedPassword = configuredValue(
      "POSTMARK_INBOUND_WEBHOOK_PASSWORD",
    );
    const supplied = decodeBasicCredentials(request);
    if (
      !supplied ||
      !secureEqual(supplied.username, expectedUsername) ||
      !secureEqual(supplied.password, expectedPassword)
    ) {
      throw new MessagingProviderError(
        "Postmark webhook authentication failed.",
        "AUTHENTICATION",
        401,
      );
    }
  },
  async parseIncomingMessage(request) {
    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody) as unknown;
    } catch {
      throw new MessagingProviderError(
        "The Postmark inbound payload is invalid.",
        "PAYLOAD",
        400,
      );
    }
    const parsed = postmarkInboundSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MessagingProviderError(
        "The Postmark inbound payload is invalid.",
        "PAYLOAD",
        400,
      );
    }
    return [
      {
        provider: "POSTMARK",
        providerEventId: parsed.data.MessageID,
        externalMessageId: parsed.data.MessageID,
        channel: "EMAIL",
        senderAddress: normalizedEmail(parsed.data.FromFull.Email),
        recipientAddress: normalizedEmail(parsed.data.ToFull[0].Email),
        providerRouteKey: parsed.data.MailboxHash,
        body: inboundBody(
          parsed.data.StrippedTextReply,
          parsed.data.TextBody,
        ),
        receivedAt: normalizedReceivedAt(parsed.data.Date),
      },
    ];
  },
};
