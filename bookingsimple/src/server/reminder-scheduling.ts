import {
  MAX_REMINDER_OFFSET_MINUTES,
} from "./reminder-types";

const MINUTE_MS = 60_000;
const MAX_RETRY_MINUTES = 60;

export function calculateReminderSchedule(
  bookingStartAt: string,
  offsetMinutes: number,
): string {
  const start = Date.parse(bookingStartAt);
  if (
    !Number.isFinite(start) ||
    !Number.isSafeInteger(offsetMinutes) ||
    offsetMinutes < 1 ||
    offsetMinutes > MAX_REMINDER_OFFSET_MINUTES
  ) {
    throw new Error("Reminder scheduling terms are invalid.");
  }
  return new Date(start - offsetMinutes * MINUTE_MS).toISOString();
}

export function calculateReminderRetryAt(
  attemptedAt: string,
  attemptCount: number,
): string {
  const attempted = Date.parse(attemptedAt);
  if (
    !Number.isFinite(attempted) ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1
  ) {
    throw new Error("Reminder retry terms are invalid.");
  }
  const delayMinutes = Math.min(2 ** (attemptCount - 1), MAX_RETRY_MINUTES);
  return new Date(attempted + delayMinutes * MINUTE_MS).toISOString();
}

export function reminderIdForRule(
  bookingId: string,
  ruleId: string,
): string {
  if (
    !/^[0-9a-f-]{36}$/i.test(bookingId) ||
    !/^[a-z]+-[1-9][0-9]{0,4}$/.test(ruleId)
  ) {
    throw new Error("Reminder identifiers are invalid.");
  }
  return `reminder-${bookingId}-${ruleId}`;
}
