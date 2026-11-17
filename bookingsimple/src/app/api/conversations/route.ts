import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  createConversation,
  listConversations,
} from "@/server/conversation-service";
import {
  parseConversationListInput,
  parseCreateConversationInput,
} from "@/server/conversation-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

function logConversationFailure(error: unknown) {
  const detail =
    error && typeof error === "object"
      ? (error as {
          name?: unknown;
          message?: unknown;
          code?: unknown;
          statusCode?: unknown;
        })
      : {};
  console.error(
    JSON.stringify({
      event: "conversation-operation-failed",
      name: typeof detail.name === "string" ? detail.name : "UnknownError",
      message:
        typeof detail.message === "string"
          ? detail.message
          : "No error message was provided.",
      code:
        typeof detail.code === "number" ||
        typeof detail.code === "string"
          ? detail.code
          : undefined,
      statusCode:
        typeof detail.statusCode === "number"
          ? detail.statusCode
          : undefined,
    }),
  );
}

export async function GET(request: Request) {
  try {
    let input;
    try {
      input = parseConversationListInput(new URL(request.url).searchParams);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(await listConversations(request, input), 200);
  } catch (error) {
    logConversationFailure(error);
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseCreateConversationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    const result = await createConversation(request, input);
    return response(result, result.created ? 201 : 200);
  } catch (error) {
    logConversationFailure(error);
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
