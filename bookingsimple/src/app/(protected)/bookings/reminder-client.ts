import {
  REMINDER_CHANNELS,
  REMINDER_STATUSES,
  type ReminderChannel,
  type ReminderStatus,
  type ReminderView,
} from "@/server/reminder-types";

function isReminder(value: unknown): value is ReminderView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "bookingId" in value &&
    typeof value.bookingId === "string" &&
    "channel" in value &&
    REMINDER_CHANNELS.includes(value.channel as ReminderChannel) &&
    "offsetMinutes" in value &&
    typeof value.offsetMinutes === "number" &&
    Number.isSafeInteger(value.offsetMinutes) &&
    value.offsetMinutes > 0 &&
    "scheduledFor" in value &&
    typeof value.scheduledFor === "string" &&
    "status" in value &&
    REMINDER_STATUSES.includes(value.status as ReminderStatus) &&
    "provider" in value &&
    (value.provider === "MOCK_TEST" || value.provider === "POSTMARK") &&
    "attemptCount" in value &&
    typeof value.attemptCount === "number" &&
    Number.isSafeInteger(value.attemptCount) &&
    value.attemptCount >= 0 &&
    (!("sentAt" in value) || typeof value.sentAt === "string") &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

export function parseReminderList(value: unknown): ReminderView[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("reminders" in value) ||
    !Array.isArray(value.reminders) ||
    !value.reminders.every(isReminder)
  ) {
    throw new Error("The server returned invalid Reminder data.");
  }
  return value.reminders;
}

export async function reminderApi(endpoint: string): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "The Reminder request could not be completed.",
    );
  }
  return result;
}
