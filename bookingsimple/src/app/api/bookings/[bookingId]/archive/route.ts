import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { setBookingArchived } from "@/server/booking-service";
import {
  parseBookingArchiveInput,
  parseBookingId,
} from "@/server/booking-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
) {
  try {
    let bookingId: string;
    let input;
    try {
      bookingId = parseBookingId((await context.params).bookingId);
      input = parseBookingArchiveInput(await parseMutationJson(request));
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      { booking: await setBookingArchived(request, bookingId, input) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
