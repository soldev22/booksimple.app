import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import {
  createBusinessInvitation,
  deleteBusinessInvitation,
} from "@/server/business-service";
import {
  parseCreateInvitationInput,
  parseDeleteInvitationInput,
} from "@/server/business-validation";
import { getSafeError } from "@/server/auth-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseCreateInvitationInput(rawInput);
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
    await createBusinessInvitation(request, input);
    return NextResponse.json(
      { message: "Invitation sent." },
      {
        status: 201,
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

export async function DELETE(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseDeleteInvitationInput(rawInput);
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
    await deleteBusinessInvitation(request, input);
    return NextResponse.json(
      { message: "Invitation deleted." },
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
