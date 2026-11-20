import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { setConversationArchived } from "@/server/conversation-service";
import {
  parseConversationArchiveInput,
  parseConversationId,
} from "@/server/conversation-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    let conversationId: string;
    let input;
    try {
      conversationId = parseConversationId(
        (await context.params).conversationId,
      );
      input = parseConversationArchiveInput(await parseMutationJson(request));
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      {
        conversation: await setConversationArchived(
          request,
          conversationId,
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
