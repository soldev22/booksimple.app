import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  getMetaManagedPages,
  selectMetaManagedPage,
} from "@/server/meta-connection-service";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function GET(request: Request) {
  try {
    const state = new URL(request.url).searchParams.get("state") ?? "";
    return response(
      { selection: await getMetaManagedPages(request, state) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    return response(
      {
        connection: await selectMetaManagedPage(
          request,
          await parseMutationJson(request),
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
