import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { parseMetaOAuthConfig } from "@/server/meta-connection-config";
import { completeMetaOAuthConnection } from "@/server/meta-connection-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const config = parseMetaOAuthConfig(process.env);
    const result = await completeMetaOAuthConnection(request);
    const url = new URL("/settings", config.appOrigin);
    if (result.outcome === "SELECT_PAGE") {
      url.searchParams.set("meta", "select");
      url.searchParams.set("state", result.state);
    } else {
      url.searchParams.set("meta", "cancelled");
    }
    return NextResponse.redirect(url);
  } catch (error) {
    getSafeError(error);
    return NextResponse.redirect(
      new URL("/settings?meta=error", request.url),
    );
  }
}
