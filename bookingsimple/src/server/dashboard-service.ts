import "server-only";

import {
  controlContainer,
  readDocument,
  StorageError,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import { getBooking } from "./booking-service";
import {
  isTimeZone,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from "./booking-time";
import type { BookingStatus, BookingView } from "./booking-types";
import {
  queryDashboardStoredData,
  type DashboardStoredData,
} from "./dashboard-storage";
import type {
  CommunicationChannel,
  ConversationDocument,
  MessageDirection,
} from "./conversation-types";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  type BusinessDocument,
} from "./business-types";
import type { ReminderChannel, ReminderDocument } from "./reminder-types";

export type DashboardDayRange = {
  startAt: string;
  endAt: string;
  localDate: string;
};

export type DashboardBookingItem = {
  id: string;
  customerName: string;
  serviceName: string;
  startAt: string;
  status: BookingStatus;
  depositAmountMinor: number;
  currency: string;
};

export type DashboardConversationItem = {
  id: string;
  contactLabel: string;
  channel: CommunicationChannel;
  lastMessagePreview: string;
  lastMessageAt: string;
};

export type DashboardReminderItem = {
  id: string;
  bookingId: string;
  customerName: string;
  serviceName: string;
  channel: ReminderChannel;
  scheduledFor: string;
  attemptCount: number;
};

export type OperationalDashboard = {
  generatedAt: string;
  timeZone: string;
  localDate: string;
  todayCount: number;
  upcomingCount: number;
  attentionCount: number;
  awaitingDepositCount: number;
  failedReminderCount: number;
  todayBookings: DashboardBookingItem[];
  upcomingBookings: DashboardBookingItem[];
  awaitingDepositBookings: DashboardBookingItem[];
  attentionConversations: DashboardConversationItem[];
  failedReminders: DashboardReminderItem[];
};

export function dashboardDayRange(
  now: string,
  timeZone: string,
): DashboardDayRange {
  if (!Number.isFinite(Date.parse(now)) || !isTimeZone(timeZone)) {
    throw new Error("Dashboard date or business timezone is invalid.");
  }
  const localDate = utcToLocalDateTime(now, timeZone).slice(0, 10);
  const [year, month, day] = localDate.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
  return {
    startAt: localDateTimeToUtc(`${localDate}T00:00`, timeZone),
    endAt: localDateTimeToUtc(`${nextDate}T00:00`, timeZone),
    localDate,
  };
}

export function requiresConversationReply(conversation: {
  lastMessageDirection: MessageDirection;
}): boolean {
  return conversation.lastMessageDirection === "INBOUND";
}

function dashboardError(message: string): StorageError {
  return new StorageError(message, 503);
}

async function dashboardTimeZone(context: TenantContext): Promise<string> {
  const stored = await readDocument<BusinessDocument>(
    controlContainer(),
    context.tenantId,
    context.tenantId,
  );
  const business = stored?.document;
  if (
    !business ||
    business.type !== "business" ||
    business.id !== context.tenantId ||
    business.partitionKey !== context.tenantId ||
    business.status !== "active"
  ) {
    throw dashboardError("The active Business could not be loaded.");
  }
  const timeZone = business.timezone ?? DEFAULT_BUSINESS_TIMEZONE;
  if (!isTimeZone(timeZone)) {
    throw dashboardError("The Business timezone is invalid.");
  }
  return timeZone;
}

function bookingItem(booking: BookingView): DashboardBookingItem {
  return {
    id: booking.id,
    customerName: booking.customerName,
    serviceName: booking.serviceName,
    startAt: booking.startAt,
    status: booking.status,
    depositAmountMinor: booking.depositAmountMinor,
    currency: booking.currency,
  };
}

function conversationItem(
  context: TenantContext,
  conversation: ConversationDocument,
): DashboardConversationItem {
  if (
    conversation.type !== "conversation" ||
    conversation.tenantId !== context.tenantId ||
    conversation.id !== conversation.conversationId ||
    !requiresConversationReply(conversation) ||
    !Number.isFinite(Date.parse(conversation.lastMessageAt)) ||
    typeof conversation.contactLabel !== "string" ||
    typeof conversation.lastMessagePreview !== "string"
  ) {
    throw dashboardError("Dashboard Conversation data is invalid.");
  }
  return {
    id: conversation.id,
    contactLabel: conversation.contactLabel,
    channel: conversation.channel,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt,
  };
}

function reminderItem(
  context: TenantContext,
  reminder: ReminderDocument,
  booking: BookingView,
): DashboardReminderItem {
  if (
    reminder.type !== "reminder" ||
    reminder.tenantId !== context.tenantId ||
    reminder.status !== "FAILED" ||
    reminder.bookingId !== booking.id ||
    !Number.isFinite(Date.parse(reminder.scheduledFor)) ||
    !Number.isSafeInteger(reminder.attemptCount) ||
    reminder.attemptCount < 0
  ) {
    throw dashboardError("Dashboard Reminder data is invalid.");
  }
  return {
    id: reminder.id,
    bookingId: reminder.bookingId,
    customerName: booking.customerName,
    serviceName: booking.serviceName,
    channel: reminder.channel,
    scheduledFor: reminder.scheduledFor,
    attemptCount: reminder.attemptCount,
  };
}

async function bookingViewsById(
  context: TenantContext,
  stored: DashboardStoredData,
): Promise<Map<string, BookingView>> {
  const ids = new Set([
    ...stored.todayBookings.map((booking) => booking.id),
    ...stored.upcomingBookings.map((booking) => booking.id),
    ...stored.awaitingDepositBookings.map((booking) => booking.id),
    ...stored.failedReminders.map((reminder) => reminder.bookingId),
  ]);
  const bookings = await Promise.all(
    [...ids].map((id) => getBooking(context, id)),
  );
  return new Map(bookings.map((booking) => [booking.id, booking]));
}

function requiredBooking(
  bookings: Map<string, BookingView>,
  id: string,
): BookingView {
  const booking = bookings.get(id);
  if (!booking) throw dashboardError("Dashboard Booking data is incomplete.");
  return booking;
}

export async function getOperationalDashboard(
  context: TenantContext,
  now = new Date(),
): Promise<OperationalDashboard> {
  const timeZone = await dashboardTimeZone(context);
  const nowIso = now.toISOString();
  const range = dashboardDayRange(nowIso, timeZone);
  const stored = await queryDashboardStoredData(
    context.tenantId,
    nowIso,
    range.startAt,
    range.endAt,
  );
  const bookings = await bookingViewsById(context, stored);
  return {
    generatedAt: nowIso,
    timeZone,
    localDate: range.localDate,
    todayCount: stored.todayCount,
    upcomingCount: stored.upcomingCount,
    attentionCount: stored.attentionCount,
    awaitingDepositCount: stored.awaitingDepositCount,
    failedReminderCount: stored.failedReminderCount,
    todayBookings: stored.todayBookings.map((booking) =>
      bookingItem(requiredBooking(bookings, booking.id)),
    ),
    upcomingBookings: stored.upcomingBookings.map((booking) =>
      bookingItem(requiredBooking(bookings, booking.id)),
    ),
    awaitingDepositBookings: stored.awaitingDepositBookings.map((booking) =>
      bookingItem(requiredBooking(bookings, booking.id)),
    ),
    attentionConversations: stored.attentionConversations.map((conversation) =>
      conversationItem(context, conversation),
    ),
    failedReminders: stored.failedReminders.map((reminder) =>
      reminderItem(
        context,
        reminder,
        requiredBooking(bookings, reminder.bookingId),
      ),
    ),
  };
}
