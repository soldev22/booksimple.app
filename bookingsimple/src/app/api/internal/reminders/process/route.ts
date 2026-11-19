import { NextResponse } from "next/server";
import { getSafeError } from "@/server/auth-service";
import { isAuthorizedReminderCron } from "@/server/reminder-cron";
import { processDueReminders } from "@/server/reminder-service";

export const runtime = "nodejs";
export const maxDuration = 300;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    console.error(
      JSON.stringify({ event: "reminder-cron-secret-not-configured" }),
    );
    return response({ error: "Reminder processing is not configured." }, 503);
  }
  if (
    !isAuthorizedReminderCron(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return response({ error: "Authorization failed." }, 401);
  }
  try {
    return response(
      {
        processed: true,
        result: await processDueReminders({ limit: 100 }),
      },
      200,
    );
  } catch (error) {
    const safe = getSafeError(error);
    console.error(
      JSON.stringify({
        event: "reminder-cron-processing-failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return response({ error: safe.message }, safe.status);
  }
}
