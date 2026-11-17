import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { getConversationDetails } from "@/server/conversation-service";
import {
  parseConversationId,
  parseMessageListInput,
} from "@/server/conversation-validation";

export const runtime = "nodejs";

type ConversationRouteContext = {
  params: Promise<{ conversationId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function GET(
  request: Request,
  context: ConversationRouteContext,
) {
  try {
    const { conversationId } = await context.params;
    let parsedConversationId: string;
    let input;
    try {
      parsedConversationId = parseConversationId(conversationId);
      input = parseMessageListInput(new URL(request.url).searchParams);
    } catch {
      return response({ error: "Conversation not found." }, 404);
    }
    return response(
      await getConversationDetails(request, parsedConversationId, input),
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
