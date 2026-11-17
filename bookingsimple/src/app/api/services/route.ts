import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  createService,
  listServices,
} from "@/server/service-service";
import {
  parseServiceMutationInput,
  parseServiceSearchInput,
} from "@/server/service-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function GET(request: Request) {
  try {
    let input;
    try {
      input = parseServiceSearchInput(new URL(request.url).searchParams);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(await listServices(request, input), 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseServiceMutationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response({ service: await createService(request, input) }, 201);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
