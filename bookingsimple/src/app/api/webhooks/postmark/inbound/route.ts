import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { processIncomingProviderMessage } from "@/server/conversation-service";
import {
  configuredMessagingProvider,
  parseProviderWebhook,
} from "@/server/messaging-service";
import { MessagingProviderError } from "@/server/messaging-provider";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_000_000;

function response(
  body: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...headers,
    },
  });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_WEBHOOK_BYTES
    ) {
      return response({ error: "Webhook payload is too large." }, 413);
    }
    const provider = configuredMessagingProvider();
    if (provider.provider !== "POSTMARK") {
      throw new MessagingProviderError(
        "Postmark messaging is not enabled.",
        "CONFIGURATION",
        503,
      );
    }
    const rawBody = await request.text();
    const headers = Object.fromEntries(
      Array.from(request.headers.entries(), ([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    const messages = await parseProviderWebhook(provider, {
      rawBody,
      headers,
    });
    const outcomes = [];
    for (const message of messages) {
      outcomes.push(await processIncomingProviderMessage(message));
    }
    return response(
      {
        accepted: true,
        processed: outcomes.filter((item) => item.status === "PROCESSED").length,
        duplicates: outcomes.filter((item) => item.status === "DUPLICATE")
          .length,
        ignored: outcomes.filter((item) => item.status === "IGNORED").length,
      },
      200,
    );
  } catch (error) {
    if (error instanceof MessagingProviderError) {
      if (error.status >= 500) {
        console.error(
          JSON.stringify({
            event: "postmark-inbound-webhook-failed",
            category: error.category,
            status: error.status,
          }),
        );
      }
      return response(
        {
          error:
            error.status >= 500
              ? "The webhook could not be processed."
              : error.message,
        },
        error.status,
        error.status === 401
          ? { "WWW-Authenticate": 'Basic realm="Postmark inbound"' }
          : undefined,
      );
    }
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
