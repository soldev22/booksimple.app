import type { ItemDefinition } from "@azure/cosmos";

export const PAYMENT_SCHEMA_VERSION = 1;
export const PAYMENT_CONTAINER_ID = "payments";

export const PAYMENT_TYPES = [
  "DEPOSIT",
  "BALANCE",
  "FULL_PAYMENT",
] as const;

export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentProvider = "MOCK_TEST" | "STRIPE";

export type PaymentDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "payment";
  schemaVersion: typeof PAYMENT_SCHEMA_VERSION;
  bookingId: string;
  paymentType: PaymentType;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  simulated: boolean;
  livemode: boolean;
  connectedAccountId?: string;
  externalPaymentId?: string;
  checkoutAttempt?: number;
  providerEventId?: string;
  processedProviderEventIds?: string[];
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentView = {
  id: string;
  bookingId: string;
  paymentType: PaymentType;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  simulated: boolean;
  livemode: boolean;
  externalPaymentId?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRequestView = {
  payment: PaymentView;
  checkoutUrl?: string;
};
