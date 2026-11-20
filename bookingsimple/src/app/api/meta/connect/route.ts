import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import {
  createMetaOAuthLink,
  disconnectMetaPage,
  getMetaConnection,
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
    return response({ connection: await getMetaConnection(request) }, 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    return response({ oauth: await createMetaOAuthLink(request) }, 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function DELETE(request: Request) {
  try {
    return response({ connection: await disconnectMetaPage(request) }, 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
