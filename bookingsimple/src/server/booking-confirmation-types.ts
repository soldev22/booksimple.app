import type { ItemDefinition } from "@azure/cosmos";
import type {
  CommunicationChannel,
  MessageDeliveryStatus,
} from "./conversation-types";

export const BOOKING_CONFIRMATION_SCHEMA_VERSION = 1;
export const BOOKING_CONFIRMATION_CONTAINER_ID = "booking-confirmations";

export type BookingConfirmationStatus =
  | "PENDING"
  | "LOCAL_ONLY"
  | "SENT"
  | "FAILED";

export type BookingConfirmationDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "booking-confirmation";
  schemaVersion: typeof BOOKING_CONFIRMATION_SCHEMA_VERSION;
  bookingId: string;
  customerId: string;
  status: BookingConfirmationStatus;
  conversationId?: string;
  messageId?: string;
  channel?: CommunicationChannel;
  messageDeliveryStatus?: MessageDeliveryStatus;
  failureCategory?: "NO_SUPPORTED_CONTACT" | "DELIVERY";
  createdAt: string;
  updatedAt: string;
};
