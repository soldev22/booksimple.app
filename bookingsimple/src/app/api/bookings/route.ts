import { NextResponse } from "next/server";
import { parseMutationJson } from "@/server/api-request";
import { getSafeError } from "@/server/auth-service";
import {
  createBooking,
  listBookings,
} from "@/server/booking-service";
import {
  parseBookingListInput,
  parseBookingMutationInput,
} from "@/server/booking-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", Vary: "Cookie" },
  });
}

export async function GET(request: Request) {
  try {
    let input;
    try {
      input = parseBookingListInput(new URL(request.url).searchParams);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(await listBookings(request, input), 200);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}

export async function POST(request: Request) {
  try {
    const rawInput = await parseMutationJson(request);
    let input;
    try {
      input = parseBookingMutationInput(rawInput);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response({ booking: await createBooking(request, input) }, 201);
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
