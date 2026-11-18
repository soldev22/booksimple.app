import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { confirmMockPayment } from "@/server/payment-service";
import {
  parseMockPaymentConfirmationInput,
  parsePaymentId,
} from "@/server/payment-validation";

export const runtime = "nodejs";

type PaymentSimulationRouteContext = {
  params: Promise<{ paymentId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: PaymentSimulationRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    const { paymentId } = await context.params;
    let parsedPaymentId: string;
    let input;
    try {
      parsedPaymentId = parsePaymentId(paymentId);
      input = parseMockPaymentConfirmationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      {
        payment: await confirmMockPayment(
          request,
          parsedPaymentId,
          input,
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
