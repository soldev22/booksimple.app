import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { eraseCustomer } from "@/server/customer-service";
import {
  parseCustomerId,
  parseEraseCustomerInput,
} from "@/server/customer-validation";

export const runtime = "nodejs";

type CustomerEraseRouteContext = {
  params: Promise<{ customerId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: CustomerEraseRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    try {
      parseEraseCustomerInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    const { customerId } = await context.params;
    let parsedCustomerId: string;
    try {
      parsedCustomerId = parseCustomerId(customerId);
    } catch {
      return response({ error: "Customer not found." }, 404);
    }
    return response(
      { customer: await eraseCustomer(request, parsedCustomerId) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
