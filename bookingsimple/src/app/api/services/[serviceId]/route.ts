import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  getServiceForRequest,
  updateService,
} from "@/server/service-service";
import {
  parseServiceId,
  parseServiceMutationInput,
} from "@/server/service-validation";

export const runtime = "nodejs";

type ServiceRouteContext = {
  params: Promise<{ serviceId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

async function serviceId(context: ServiceRouteContext) {
  try {
    return parseServiceId((await context.params).serviceId);
  } catch {
    throw Object.assign(new Error("Service not found."), { status: 404 });
  }
}

export async function GET(request: Request, context: ServiceRouteContext) {
  try {
    return response(
      { service: await getServiceForRequest(request, await serviceId(context)) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function PATCH(request: Request, context: ServiceRouteContext) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseServiceMutationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      { service: await updateService(request, await serviceId(context), input) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
