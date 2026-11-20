import type { ItemDefinition } from "@azure/cosmos";
import type { CustomerStatus } from "./customer-types";

export const BOOKING_SCHEMA_VERSION = 2;
export const BOOKING_CONTAINER_ID = "bookings";

export const BOOKING_STATUSES = [
  "PENDING",
  "AWAITING_DEPOSIT",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "booking";
  schemaVersion: typeof BOOKING_SCHEMA_VERSION;
  customerId: string;
  serviceId: string;
  staffUserId?: string;
  staffName?: string;
  staffUsername?: string;
  conversationId?: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  durationMinutes: number;
  status: BookingStatus;
  totalAmountMinor: number;
  currency: string;
  defaultDepositPercentage: number;
  appliedDepositPercentage: number;
  depositAmountMinor: number;
  depositOverridden: boolean;
  depositOverriddenByUserId?: string;
  depositOverriddenByUsername?: string;
  depositOverriddenAt?: string;
  archivedAt?: string;
  archivedByUserId?: string;
  archivedByUsername?: string;
  archivedFromStatus?: BookingStatus;
  createdAt: string;
  updatedAt: string;
};

export type BookingView = {
  id: string;
  customerId: string;
  customerName: string;
  customerStatus: CustomerStatus;
  serviceId: string;
  serviceName: string;
  serviceActive: boolean;
  staffUserId?: string;
  staffName?: string;
  staffUsername?: string;
  conversationId?: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  durationMinutes: number;
  status: BookingStatus;
  totalAmountMinor: number;
  currency: string;
  defaultDepositPercentage: number;
  appliedDepositPercentage: number;
  depositAmountMinor: number;
  depositOverridden: boolean;
  depositOverriddenByUsername?: string;
  depositOverriddenAt?: string;
  archivedAt?: string;
  archivedByUserId?: string;
  archivedByUsername?: string;
  archivedFromStatus?: BookingStatus;
  createdAt: string;
  updatedAt: string;
};

export type BookingPage = {
  bookings: BookingView[];
  timeZone: string;
  continuationToken?: string;
};
