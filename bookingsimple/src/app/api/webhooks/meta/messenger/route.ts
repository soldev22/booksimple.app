import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { processIncomingProviderMessage } from "@/server/conversation-service";
import {
  metaMessengerMessagingProvider,
  verifyMetaWebhookChallenge,
} from "@/server/meta-messenger-messaging-provider";
import { parseProviderWebhook } from "@/server/messaging-service";
import { MessagingProviderError } from "@/server/messaging-provider";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_000_000;

function textResponse(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: Request) {
  try {
    return textResponse(
      verifyMetaWebhookChallenge(new URL(request.url).searchParams),
      200,
    );
  } catch (error) {
    if (error instanceof MessagingProviderError) {
      return textResponse("", error.status);
    }
    const safe = getSafeError(error);
    return textResponse("", safe.status);
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_WEBHOOK_BYTES
    ) {
      return textResponse("", 413);
    }
    const rawBody = await request.text();
    const headers = Object.fromEntries(
      Array.from(request.headers.entries(), ([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    const messages = await parseProviderWebhook(
      metaMessengerMessagingProvider,
      { rawBody, headers },
    );
    for (const message of messages) {
      await processIncomingProviderMessage(message);
    }
    return textResponse("EVENT_RECEIVED", 200);
  } catch (error) {
    if (error instanceof MessagingProviderError) {
      if (error.status >= 500) {
        console.error(
          JSON.stringify({
            event: "meta-messenger-inbound-webhook-failed",
            category: error.category,
            status: error.status,
          }),
        );
      }
      return textResponse("", error.status);
    }
    const safe = getSafeError(error);
    return textResponse("", safe.status);
  }
}
