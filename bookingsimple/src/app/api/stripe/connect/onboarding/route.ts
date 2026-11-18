import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { createStripeOnboardingLink } from "@/server/stripe-connect-service";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(request: Request) {
  try {
    const input = await parseMutationJson(request);
    if (
      typeof input !== "object" ||
      input === null ||
      Object.keys(input).length !== 0
    ) {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      { onboarding: await createStripeOnboardingLink(request) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
