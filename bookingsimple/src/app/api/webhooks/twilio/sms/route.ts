import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { processIncomingProviderMessage } from "@/server/conversation-service";
import {
  parseProviderWebhook,
} from "@/server/messaging-service";
import { MessagingProviderError } from "@/server/messaging-provider";
import { twilioSmsMessagingProvider } from "@/server/twilio-sms-messaging-provider";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 64_000;

function response(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8",
      Pragma: "no-cache",
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
      return response("<Response></Response>", 413);
    }
    const rawBody = await request.text();
    const headers = Object.fromEntries(
      Array.from(request.headers.entries(), ([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    const messages = await parseProviderWebhook(twilioSmsMessagingProvider, {
      rawBody,
      headers,
      url: request.url,
    });
    for (const message of messages) {
      await processIncomingProviderMessage(message);
    }
    return response("<Response></Response>", 200);
  } catch (error) {
    if (error instanceof MessagingProviderError) {
      if (error.status >= 500) {
        console.error(
          JSON.stringify({
            event: "twilio-sms-inbound-webhook-failed",
            category: error.category,
            status: error.status,
          }),
        );
      }
      return response("<Response></Response>", error.status);
    }
    const safe = getSafeError(error);
    return response("<Response></Response>", safe.status);
  }
}
