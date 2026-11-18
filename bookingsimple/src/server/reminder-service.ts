import "server-only";

import { getRequestViewer } from "./auth";
import {
  isConflict,
  isPreconditionFailed,
  StorageError,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import { readBookingDocument } from "./booking-storage";
import type { BookingDocument } from "./booking-types";
import { isTimeZone } from "./booking-time";
import { deliverMockReminder } from "./mock-reminder-provider";
import {
  calculateReminderRetryAt,
  calculateReminderSchedule,
  reminderIdForRule,
} from "./reminder-scheduling";
import {
  createReminderDocument,
  deleteReminderDocument,
  queryBookingReminders,
  queryDueReminders,
  readReminderDocument,
  replaceReminderDocument,
} from "./reminder-storage";
import {
  MAX_REMINDER_OFFSET_MINUTES,
  REMINDER_CHANNELS,
  REMINDER_SCHEMA_VERSION,
  REMINDER_STATUSES,
  type BusinessReminderRule,
  type ReminderDocument,
  type ReminderProcessingResult,
  type ReminderView,
} from "./reminder-types";
import { requireTenantContext } from "./tenant-context";

const FINAL_BOOKING_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
const PROCESSING_LEASE_MS = 5 * 60_000;
const MAX_PROCESSING_BATCH = 100;

function reminderError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function isReminderDocument(
  document: ReminderDocument,
  id: string,
  tenantId: string,
): boolean {
  return (
    document.id === id &&
    document.tenantId === tenantId &&
    document.type === "reminder" &&
    document.schemaVersion === REMINDER_SCHEMA_VERSION &&
    typeof document.bookingId === "string" &&
    typeof document.ruleId === "string" &&
    REMINDER_CHANNELS.includes(document.channel) &&
    Number.isSafeInteger(document.offsetMinutes) &&
    document.offsetMinutes >= 1 &&
    document.offsetMinutes <= MAX_REMINDER_OFFSET_MINUTES &&
    Number.isFinite(Date.parse(document.bookingStartAt)) &&
    isTimeZone(document.timeZone) &&
    Number.isFinite(Date.parse(document.scheduledFor)) &&
    REMINDER_STATUSES.includes(document.status) &&
    document.provider === "MOCK_TEST" &&
    Number.isSafeInteger(document.attemptCount) &&
    document.attemptCount >= 0 &&
    Number.isFinite(Date.parse(document.nextAttemptAt)) &&
    (document.sentAt === undefined ||
      Number.isFinite(Date.parse(document.sentAt))) &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string"
  );
}

function toReminderView(document: ReminderDocument): ReminderView {
  return {
    id: document.id,
    bookingId: document.bookingId,
    channel: document.channel,
    offsetMinutes: document.offsetMinutes,
    scheduledFor: document.scheduledFor,
    status: document.status,
    provider: document.provider,
    attemptCount: document.attemptCount,
    sentAt: document.sentAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

async function readOwnedBooking(
  tenantId: string,
  bookingId: string,
): Promise<BookingDocument> {
  const booking = await readBookingDocument(bookingId, tenantId);
  if (!booking) throw reminderError(404, "Booking not found.");
  if (
    booking.document.id !== bookingId ||
    booking.document.tenantId !== tenantId ||
    booking.document.type !== "booking"
  ) {
    throw reminderError(503, "The Booking record is invalid.");
  }
  return booking.document;
}

async function createReminder(
  booking: BookingDocument,
  rule: BusinessReminderRule,
): Promise<void> {
  const id = reminderIdForRule(booking.id, rule.id);
  const existing = await readReminderDocument(id, booking.tenantId);
  if (existing) {
    if (!isReminderDocument(existing.document, id, booking.tenantId)) {
      throw reminderError(503, "The Reminder record is invalid.");
    }
    return;
  }
  const now = new Date().toISOString();
  const scheduledFor = calculateReminderSchedule(
    booking.startAt,
    rule.offsetMinutes,
  );
  const document: ReminderDocument = {
    id,
    tenantId: booking.tenantId,
    type: "reminder",
    schemaVersion: REMINDER_SCHEMA_VERSION,
    bookingId: booking.id,
    ruleId: rule.id,
    channel: rule.channel,
    offsetMinutes: rule.offsetMinutes,
    bookingStartAt: booking.startAt,
    timeZone: booking.timeZone,
    scheduledFor,
    status: "PENDING",
    provider: "MOCK_TEST",
    attemptCount: 0,
    nextAttemptAt: scheduledFor,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await createReminderDocument(document);
  } catch (error) {
    if (!isConflict(error)) throw error;
    const concurrent = await readReminderDocument(id, booking.tenantId);
    if (
      !concurrent ||
      !isReminderDocument(concurrent.document, id, booking.tenantId)
    ) {
      throw reminderError(503, "The Reminder record is invalid.");
    }
  }
}

export async function createBookingReminders(
  booking: BookingDocument,
  rules: BusinessReminderRule[],
): Promise<void> {
  const createdIds: string[] = [];
  try {
    for (const rule of rules) {
      await createReminder(booking, rule);
      createdIds.push(reminderIdForRule(booking.id, rule.id));
    }
  } catch (error) {
    await Promise.all(
      createdIds.map((id) =>
        deleteReminderDocument(id, booking.tenantId).catch((cleanupError) => {
          console.error({
            event: "reminder-creation-rollback-failed",
            reminderId: id,
            error:
              cleanupError instanceof Error
                ? cleanupError.name
                : "UnknownError",
          });
        }),
      ),
    );
    throw error;
  }
}

export async function deleteBookingReminders(
  tenantId: string,
  bookingId: string,
): Promise<void> {
  const reminders = await queryBookingReminders(tenantId, bookingId);
  await Promise.all(
    reminders.map((reminder) =>
      deleteReminderDocument(reminder.id, tenantId),
    ),
  );
}

export async function rescheduleBookingReminders(
  booking: BookingDocument,
): Promise<void> {
  const reminders = await queryBookingReminders(
    booking.tenantId,
    booking.id,
  );
  for (const reminder of reminders) {
    if (!isReminderDocument(reminder, reminder.id, booking.tenantId)) {
      throw reminderError(503, "The Booking contains an invalid Reminder.");
    }
    if (reminder.status === "SENT" || reminder.status === "CANCELLED") {
      continue;
    }
    const current = await readReminderDocument(
      reminder.id,
      booking.tenantId,
    );
    if (!current) continue;
    const scheduledFor = calculateReminderSchedule(
      booking.startAt,
      reminder.offsetMinutes,
    );
    try {
      await replaceReminderDocument(
        {
          ...current.document,
          bookingStartAt: booking.startAt,
          timeZone: booking.timeZone,
          scheduledFor,
          status: "PENDING",
          nextAttemptAt: scheduledFor,
          processingStartedAt: undefined,
          processingLeaseExpiresAt: undefined,
          lastErrorCode: undefined,
          updatedAt: new Date().toISOString(),
        },
        current.etag,
      );
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw reminderError(
          409,
          "A Reminder changed while the Booking was updated. Retry.",
        );
      }
      throw error;
    }
  }
}

export async function cancelBookingReminders(
  tenantId: string,
  bookingId: string,
): Promise<void> {
  const reminders = await queryBookingReminders(tenantId, bookingId);
  for (const reminder of reminders) {
    if (reminder.status === "SENT" || reminder.status === "CANCELLED") {
      continue;
    }
    const current = await readReminderDocument(reminder.id, tenantId);
    if (!current) continue;
    try {
      await replaceReminderDocument(
        {
          ...current.document,
          status: "CANCELLED",
          processingStartedAt: undefined,
          processingLeaseExpiresAt: undefined,
          updatedAt: new Date().toISOString(),
        },
        current.etag,
      );
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
    }
  }
}

export async function listBookingReminders(
  request: Request,
  bookingId: string,
): Promise<ReminderView[]> {
  const context = await contextForRequest(request);
  await readOwnedBooking(context.tenantId, bookingId);
  const reminders = await queryBookingReminders(
    context.tenantId,
    bookingId,
  );
  if (
    reminders.some(
      (reminder) =>
        !isReminderDocument(reminder, reminder.id, context.tenantId),
    )
  ) {
    throw reminderError(503, "The Booking contains an invalid Reminder.");
  }
  return reminders.map(toReminderView);
}

async function processReminder(
  candidate: ReminderDocument,
  now: string,
): Promise<"sent" | "cancelled" | "failed" | "skipped"> {
  const current = await readReminderDocument(
    candidate.id,
    candidate.tenantId,
  );
  if (
    !current ||
    !isReminderDocument(
      current.document,
      candidate.id,
      candidate.tenantId,
    )
  ) {
    return "skipped";
  }
  if (
    current.document.status === "SENT" ||
    current.document.status === "CANCELLED" ||
    Date.parse(current.document.scheduledFor) > Date.parse(now) ||
    (current.document.status === "PROCESSING" &&
      Date.parse(current.document.processingLeaseExpiresAt ?? "") >
        Date.parse(now))
  ) {
    return "skipped";
  }
  const attemptCount = current.document.attemptCount + 1;
  let claimed;
  try {
    claimed = await replaceReminderDocument(
      {
        ...current.document,
        status: "PROCESSING",
        attemptCount,
        lastAttemptAt: now,
        processingStartedAt: now,
        processingLeaseExpiresAt: new Date(
          Date.parse(now) + PROCESSING_LEASE_MS,
        ).toISOString(),
        updatedAt: now,
      },
      current.etag,
    );
  } catch (error) {
    if (isPreconditionFailed(error)) return "skipped";
    throw error;
  }
  const booking = await readBookingDocument(
    claimed.document.bookingId,
    claimed.document.tenantId,
  );
  if (
    !booking ||
    FINAL_BOOKING_STATUSES.includes(booking.document.status)
  ) {
    await replaceReminderDocument(
      {
        ...claimed.document,
        status: "CANCELLED",
        processingStartedAt: undefined,
        processingLeaseExpiresAt: undefined,
        updatedAt: now,
      },
      claimed.etag,
    );
    return "cancelled";
  }
  const currentSchedule = calculateReminderSchedule(
    booking.document.startAt,
    claimed.document.offsetMinutes,
  );
  if (Date.parse(currentSchedule) > Date.parse(now)) {
    await replaceReminderDocument(
      {
        ...claimed.document,
        bookingStartAt: booking.document.startAt,
        timeZone: booking.document.timeZone,
        scheduledFor: currentSchedule,
        status: "PENDING",
        nextAttemptAt: currentSchedule,
        processingStartedAt: undefined,
        processingLeaseExpiresAt: undefined,
        updatedAt: now,
      },
      claimed.etag,
    );
    return "skipped";
  }
  try {
    const delivery = await deliverMockReminder(claimed.document.id);
    await replaceReminderDocument(
      {
        ...claimed.document,
        status: "SENT",
        sentAt: now,
        providerReference: delivery.providerReference,
        processingStartedAt: undefined,
        processingLeaseExpiresAt: undefined,
        lastErrorCode: undefined,
        updatedAt: now,
      },
      claimed.etag,
    );
    return "sent";
  } catch (error) {
    const latest = await readReminderDocument(
      claimed.document.id,
      claimed.document.tenantId,
    );
    if (!latest || latest.document.status === "SENT") {
      return latest?.document.status === "SENT" ? "sent" : "failed";
    }
    await replaceReminderDocument(
      {
        ...latest.document,
        status: "FAILED",
        nextAttemptAt: calculateReminderRetryAt(now, attemptCount),
        processingStartedAt: undefined,
        processingLeaseExpiresAt: undefined,
        lastErrorCode:
          error instanceof Error ? error.name : "UnknownError",
        updatedAt: now,
      },
      latest.etag,
    );
    return "failed";
  }
}

export async function processDueReminders(
  options: {
    now?: string;
    limit?: number;
    tenantId?: string;
  } = {},
): Promise<ReminderProcessingResult> {
  const now = options.now ?? new Date().toISOString();
  const limit = options.limit ?? 50;
  if (
    !Number.isFinite(Date.parse(now)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PROCESSING_BATCH
  ) {
    throw reminderError(400, "Reminder processing options are invalid.");
  }
  const candidates = await queryDueReminders(
    now,
    limit,
    options.tenantId,
  );
  const result: ReminderProcessingResult = {
    claimed: candidates.length,
    sent: 0,
    cancelled: 0,
    failed: 0,
  };
  for (const candidate of candidates) {
    const outcome = await processReminder(candidate, now);
    if (outcome === "sent") result.sent += 1;
    if (outcome === "cancelled") result.cancelled += 1;
    if (outcome === "failed") result.failed += 1;
  }
  return result;
}
