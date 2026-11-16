import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { acceptBusinessInvitation } from "@/server/business-service";
import { parseAcceptInvitationInput } from "@/server/business-validation";
import { getSafeError } from "@/server/auth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseAcceptInvitationInput(rawInput);
    } catch {
      return NextResponse.json(
        { error: "Request validation failed." },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
            Pragma: "no-cache",
            Vary: "Cookie",
          },
        },
      );
    }
    await acceptBusinessInvitation(request, input.token);
    return NextResponse.json(
      {
        message: "Invitation accepted. Sign in again to open the workspace.",
        redirect: "/login",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          Vary: "Cookie",
        },
      },
    );
  } catch (error) {
    const safe = getSafeError(error);
    return NextResponse.json(
      { error: safe.message },
      {
        status: safe.status,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          Vary: "Cookie",
        },
      },
    );
  }
}
