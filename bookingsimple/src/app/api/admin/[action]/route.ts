import { NextResponse } from "next/server";
import { applicationOrigin } from "@/server/auth-notifications";
import { getSafeError, runAdminAction } from "@/server/auth-service";
import { consumeRateLimit } from "@/server/auth-storage";
import { parseAuthInput } from "@/server/auth-validation";

const adminActionSchemas = [
  "approve",
  "reject",
  "platform-role",
  "account-status",
  "delete-user",
  "assign",
] as const;
type AdminAction = (typeof adminActionSchemas)[number];
const MAX_BODY_BYTES = 8_192;
export const runtime = "nodejs";

function apiResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

async function parseRequestBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json."), {
      status: 415,
    });
  }
  const origin = request.headers.get("origin");
  let matchesOrigin = false;
  try {
    matchesOrigin = Boolean(origin) && new URL(origin!).origin === applicationOrigin();
  } catch {
    matchesOrigin = false;
  }
  if (!matchesOrigin) {
    throw Object.assign(new Error("The request origin is not allowed."), {
      status: 403,
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      status: 400,
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  try {
    const { action: actionName } = await context.params;
    if (!adminActionSchemas.includes(actionName as AdminAction)) {
      return apiResponse({ error: "This administrator action was not found." }, 404);
    }
    const rawInput = await parseRequestBody(request);
    const action = actionName as AdminAction;
    let parsed: Record<string, unknown>;
    try {
      parsed = parseAuthInput(action, rawInput) as Record<string, unknown>;
    } catch {
      return apiResponse({ error: "Request validation failed." }, 400);
    }
    const sessionId = request.headers.get("cookie")?.slice(0, 256) ?? "anonymous";
    await consumeRateLimit("admin-action", `${action}:${sessionId}`, 30, 600);
    const result = await runAdminAction(action, parsed, request);
    return apiResponse(result.body, result.status);
  } catch (error) {
    const safe = getSafeError(error);
    return apiResponse({ error: safe.message }, safe.status);
  }
}
