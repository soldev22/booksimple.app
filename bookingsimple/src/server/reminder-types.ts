import type { ItemDefinition } from "@azure/cosmos";

export const REMINDER_SCHEMA_VERSION = 1;
export const REMINDER_CONTAINER_ID = "reminders";
export const MAX_REMINDER_RULES = 5;
export const MAX_REMINDER_OFFSET_MINUTES = 7 * 24 * 60;

export const REMINDER_CHANNELS = [
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "META",
] as const;

export const REMINDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const;

export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export type BusinessReminderRule = {
  id: string;
  channel: ReminderChannel;
  offsetMinutes: number;
};

export type ReminderDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "reminder";
  schemaVersion: typeof REMINDER_SCHEMA_VERSION;
  bookingId: string;
  ruleId: string;
  channel: ReminderChannel;
  offsetMinutes: number;
  bookingStartAt: string;
  timeZone: string;
  scheduledFor: string;
  status: ReminderStatus;
  provider: "MOCK_TEST" | "POSTMARK";
  conversationId?: string;
  messageId?: string;
  attemptCount: number;
  nextAttemptAt: string;
  processingStartedAt?: string;
  processingLeaseExpiresAt?: string;
  sentAt?: string;
  providerReference?: string;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderView = {
  id: string;
  bookingId: string;
  channel: ReminderChannel;
  offsetMinutes: number;
  scheduledFor: string;
  status: ReminderStatus;
  provider: "MOCK_TEST" | "POSTMARK";
  attemptCount: number;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderProcessingResult = {
  claimed: number;
  sent: number;
  cancelled: number;
  failed: number;
};
