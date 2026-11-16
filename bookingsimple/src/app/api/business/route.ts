import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import {
  getBusinessSetup,
  updateBusinessSettings,
} from "@/server/business-service";
import { parseBusinessUpdateInput } from "@/server/business-validation";
import { getSafeError } from "@/server/auth-service";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function GET(request: Request) {
  try {
    return response(await getBusinessSetup(request), 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function PATCH(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseBusinessUpdateInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    const business = await updateBusinessSettings(request, input);
    return response(
      { message: "Business settings updated.", business },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
