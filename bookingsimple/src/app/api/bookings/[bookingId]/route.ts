import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  getBookingForRequest,
  updateBooking,
} from "@/server/booking-service";
import {
  parseBookingId,
  parseBookingUpdateInput,
} from "@/server/booking-validation";

export const runtime = "nodejs";

type BookingRouteContext = {
  params: Promise<{ bookingId: string }>;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

async function bookingIdFromContext(
  context: BookingRouteContext,
): Promise<string | null> {
  try {
    return parseBookingId((await context.params).bookingId);
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: BookingRouteContext,
) {
  try {
    const bookingId = await bookingIdFromContext(context);
    if (!bookingId) return response({ error: "Booking not found." }, 404);
    return response(
      { booking: await getBookingForRequest(request, bookingId) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function PATCH(
  request: Request,
  context: BookingRouteContext,
) {
  try {
    const rawInput = await parseMutationJson(request);
    const bookingId = await bookingIdFromContext(context);
    if (!bookingId) return response({ error: "Booking not found." }, 404);
    let input;
    try {
      input = parseBookingUpdateInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      { booking: await updateBooking(request, bookingId, input) },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
