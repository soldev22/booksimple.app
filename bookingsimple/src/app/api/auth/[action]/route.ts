import { NextResponse } from "next/server";
import { clearAuthCookie, setAuthCookie } from "@/server/auth";
import { applicationOrigin } from "@/server/auth-notifications";
import { runAuthAction, getSafeError } from "@/server/auth-service";
import {
  parseAuthInput,
  type AuthAction,
} from "@/server/auth-validation";

const allowedActions = new Set<AuthAction>([
  "register",
  "login",
  "logout",
  "verify",
  "request-reset",
  "resend-verification",
  "reset",
]);
const MAX_BODY_BYTES = 8_192;
export const runtime = "nodejs";

function response(
  body: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "Cookie",
    },
  });
}

async function validateRequest(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "application/json") {
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
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body is too large."), {
      status: 413,
    });
  }
  try {
    return JSON.parse(rawBody) as unknown;
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
    if (!allowedActions.has(actionName as AuthAction)) {
      return response({ error: "This authentication action was not found." }, 404);
    }

    const rawInput = await validateRequest(request);
    const action = actionName as AuthAction;
    let parsedInput: unknown;
    try {
      parsedInput = parseAuthInput(action, rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    const result = await runAuthAction(
      action,
      parsedInput as Record<string, unknown>,
      request,
    );
    if (result.sessionToken) {
      await setAuthCookie(result.sessionToken);
    } else if (result.clearCookie) {
      await clearAuthCookie();
    }
    return response(result.body, result.status);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
