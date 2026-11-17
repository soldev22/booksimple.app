import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { linkConversationCustomer } from "@/server/conversation-service";
import {
  parseConversationId,
  parseLinkCustomerInput,
} from "@/server/conversation-validation";

export const runtime = "nodejs";

type ConversationCustomerRouteContext = {
  params: Promise<{ conversationId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: ConversationCustomerRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    const { conversationId } = await context.params;
    let parsedConversationId: string;
    let input;
    try {
      parsedConversationId = parseConversationId(conversationId);
      input = parseLinkCustomerInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      {
        conversation: await linkConversationCustomer(
          request,
          parsedConversationId,
          input.customerId,
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
