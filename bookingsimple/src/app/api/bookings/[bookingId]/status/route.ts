import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import { setBookingStatus } from "@/server/booking-service";
import {
  parseBookingId,
  parseBookingStatusInput,
} from "@/server/booking-validation";

export const runtime = "nodejs";

type BookingStatusRouteContext = {
  params: Promise<{ bookingId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function POST(
  request: Request,
  context: BookingStatusRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    const { bookingId } = await context.params;
    let parsedBookingId: string;
    let input;
    try {
      parsedBookingId = parseBookingId(bookingId);
      input = parseBookingStatusInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      {
        booking: await setBookingStatus(
          request,
          parsedBookingId,
          input.status,
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
