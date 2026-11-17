import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  archiveCustomer,
  getCustomerForRequest,
  updateCustomer,
} from "@/server/customer-service";
import {
  parseCustomerId,
  parseCustomerMutationInput,
} from "@/server/customer-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

type CustomerRouteContext = {
  params: Promise<{ customerId: string }>;
};

async function customerId(context: CustomerRouteContext) {
  try {
    return parseCustomerId((await context.params).customerId);
  } catch {
    throw Object.assign(new Error("Customer not found."), { status: 404 });
  }
}

export async function GET(
  request: Request,
  context: CustomerRouteContext,
) {
  try {
    return response(
      { customer: await getCustomerForRequest(request, await customerId(context)) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function PATCH(
  request: Request,
  context: CustomerRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseCustomerMutationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      await updateCustomer(request, await customerId(context), input),
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function DELETE(
  request: Request,
  context: CustomerRouteContext,
) {
  try {
    return response(
      { customer: await archiveCustomer(request, await customerId(context)) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
