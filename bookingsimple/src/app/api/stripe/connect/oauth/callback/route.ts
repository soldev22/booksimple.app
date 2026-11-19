import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import {
  completeStripeOAuthConnection,
} from "@/server/stripe-connect-service";
import { parseStripeConfig } from "@/server/stripe-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = parseStripeConfig(process.env);
  try {
    const result = await completeStripeOAuthConnection(request.url);
    const status =
      result.outcome === "CONNECTED" ? "connected" : "cancelled";
    return NextResponse.redirect(
      `${config.appOrigin}/account?stripe=${status}`,
    );
  } catch (error) {
    getSafeError(error);
    return NextResponse.redirect(`${config.appOrigin}/account?stripe=error`);
  }
}
