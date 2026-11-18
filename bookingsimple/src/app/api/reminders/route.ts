import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { listBookingReminders } from "@/server/reminder-service";
import { parseReminderListInput } from "@/server/reminder-validation";

export const runtime = "nodejs";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "Cookie",
    },
  });
}

export async function GET(request: Request) {
  try {
    let input;
    try {
      input = parseReminderListInput(new URL(request.url).searchParams);
    } catch {
      return response({ error: "Request validation failed." }, 400);
    }
    return response(
      {
        reminders: await listBookingReminders(
          request,
          input.bookingId,
        ),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    return response({ error: safe.message }, safe.status);
  }
}
