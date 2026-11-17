import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { setServiceActive } from "@/server/service-service";
import {
  parseServiceId,
  parseServiceStatusInput,
} from "@/server/service-validation";

export const runtime = "nodejs";

type ServiceStatusRouteContext = {
  params: Promise<{ serviceId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: ServiceStatusRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseServiceStatusInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    const { serviceId } = await context.params;
    let parsedServiceId: string;
    try {
      parsedServiceId = parseServiceId(serviceId);
    } catch {
      return response({ error: "Service not found." }, 404);
    }
    return response(
      {
        service: await setServiceActive(
          request,
          parsedServiceId,
          input.active,
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
