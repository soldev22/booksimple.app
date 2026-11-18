import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { processStripeWebhook } from "@/server/payment-service";

export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 1_048_576;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return response({ error: "Stripe-Signature is required." }, 400);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_WEBHOOK_BYTES
  ) {
    return response({ error: "Webhook body is too large." }, 413);
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return response({ error: "Webhook body is too large." }, 413);
  }
  try {
    await processStripeWebhook(rawBody, signature);
    return response({ received: true }, 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
