import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReminderSchedule,
  calculateReminderRetryAt,
  reminderIdForRule,
} from "../src/server/reminder-scheduling.ts";
import { parseReminderListInput } from "../src/server/reminder-validation.ts";

const bookingId = "11111111-1111-4111-8111-111111111111";

test("Reminder scheduling uses the Booking UTC instant and configured offset", () => {
  assert.equal(
    calculateReminderSchedule("2026-03-29T09:30:00.000Z", 1440),
    "2026-03-28T09:30:00.000Z",
  );
  assert.equal(
    calculateReminderSchedule("2026-10-25T10:30:00.000Z", 120),
    "2026-10-25T08:30:00.000Z",
  );
  assert.throws(() => calculateReminderSchedule("invalid", 120));
  assert.throws(() =>
    calculateReminderSchedule("2026-10-25T10:30:00.000Z", 0),
  );
});

test("Reminder identifiers and retry times are deterministic and bounded", () => {
  assert.equal(
    reminderIdForRule(bookingId, "email-1440"),
    `reminder-${bookingId}-email-1440`,
  );
  assert.equal(
    calculateReminderRetryAt("2026-01-01T00:00:00.000Z", 1),
    "2026-01-01T00:01:00.000Z",
  );
  assert.equal(
    calculateReminderRetryAt("2026-01-01T00:00:00.000Z", 8),
    "2026-01-01T01:00:00.000Z",
  );
});

test("Reminder list input accepts only a Booking identifier", () => {
  assert.deepEqual(
    parseReminderListInput(new URLSearchParams({ bookingId })),
    { bookingId },
  );
  assert.throws(() => parseReminderListInput(new URLSearchParams()));
  assert.throws(() =>
    parseReminderListInput(
      new URLSearchParams({ bookingId, tenantId: bookingId }),
    ),
  );
});
