import "server-only";

import { createHash } from "node:crypto";
import { isConflict, StorageError } from "./auth-storage";
import type { TenantContext } from "./auth-types";
import {
  createBookingConfirmation,
  readBookingConfirmation,
  replaceBookingConfirmation,
} from "./booking-confirmation-storage";
import {
  BOOKING_CONFIRMATION_SCHEMA_VERSION,
  type BookingConfirmationDocument,
} from "./booking-confirmation-types";
import type { BookingView } from "./booking-types";
import {
  addConversationMessageForContext,
  ensureCustomerConversationForContext,
} from "./conversation-service";
import { readConversationDocument } from "./conversation-storage";
import type { ConversationView } from "./conversation-types";
import { getCustomer } from "./customer-service";
import { configuredMessagingProvider } from "./messaging-service";

export function bookingConfirmationId(bookingId: string): string {
  return `booking-confirmation-${bookingId}`;
}

export function bookingConfirmationMessageId(bookingId: string): string {
  const bytes = createHash("sha256")
    .update(`booking-confirmation\n${bookingId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function bookingConfirmationMessage(
  context: TenantContext,
  booking: BookingView,
): string {
  const start = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: booking.timeZone,
  }).format(new Date(booking.startAt));
  return [
    `Hello ${booking.customerName},`,
    "",
    `Your booking with ${context.businessName} is confirmed.`,
    "",
    `Service: ${booking.serviceName}`,
    `Date and time: ${start}`,
    `Duration: ${booking.durationMinutes} minutes`,
    `Booking reference: ${booking.id}`,
    "",
    "If you need to make a change, reply to this message.",
  ].join("\n");
}

function assertConfirmation(
  document: BookingConfirmationDocument,
  context: TenantContext,
  booking: BookingView,
): void {
  if (
    document.id !== bookingConfirmationId(booking.id) ||
    document.tenantId !== context.tenantId ||
    document.type !== "booking-confirmation" ||
    document.schemaVersion !== BOOKING_CONFIRMATION_SCHEMA_VERSION ||
    document.bookingId !== booking.id ||
    document.customerId !== booking.customerId
  ) {
    throw new StorageError("Booking confirmation data is invalid.", 503);
  }
}

export async function preferredBookingConversation(
  context: TenantContext,
  booking: Pick<BookingView, "customerId" | "conversationId">,
): Promise<ConversationView | null> {
  const provider = configuredMessagingProvider();
  if (booking.conversationId) {
    const stored = await readConversationDocument(
      booking.conversationId,
      context.tenantId,
    );
    if (
      stored?.document.type === "conversation" &&
      stored.document.tenantId === context.tenantId &&
      stored.document.conversationId === booking.conversationId &&
      stored.document.customerId === booking.customerId &&
      provider.supportedChannels.includes(stored.document.channel)
    ) {
      return {
        id: stored.document.id,
        customerId: stored.document.customerId,
        channel: stored.document.channel,
        contactLabel: stored.document.contactLabel,
        messageCount: stored.document.messageCount,
        lastMessagePreview: stored.document.lastMessagePreview,
        lastMessageDirection: stored.document.lastMessageDirection,
        lastMessageAt: stored.document.lastMessageAt,
        createdAt: stored.document.createdAt,
        updatedAt: stored.document.updatedAt,
      };
    }
  }

  const customer = await getCustomer(context, booking.customerId);
  if (
    !customer.email ||
    !provider.supportedChannels.includes("EMAIL")
  ) {
    return null;
  }
  try {
    return await ensureCustomerConversationForContext(context, {
      customerId: customer.id,
      channel: "EMAIL",
      normalizedContact: customer.email,
      contactLabel: customer.name,
    });
  } catch (error) {
    if (error instanceof StorageError && error.status === 409) {
      return null;
    }
    throw error;
  }
}

async function markFailed(
  confirmation: Awaited<ReturnType<typeof createBookingConfirmation>>,
  failureCategory: "NO_SUPPORTED_CONTACT" | "DELIVERY",
): Promise<BookingConfirmationDocument> {
  const updated = await replaceBookingConfirmation(
    {
      ...confirmation.document,
      status: "FAILED",
      failureCategory,
      updatedAt: new Date().toISOString(),
    },
    confirmation.etag,
  );
  return updated.document;
}

export async function ensureBookingConfirmation(
  context: TenantContext,
  booking: BookingView,
): Promise<BookingConfirmationDocument> {
  const id = bookingConfirmationId(booking.id);
  const now = new Date().toISOString();
  let confirmation;
  try {
    confirmation = await createBookingConfirmation({
      id,
      tenantId: context.tenantId,
      type: "booking-confirmation",
      schemaVersion: BOOKING_CONFIRMATION_SCHEMA_VERSION,
      bookingId: booking.id,
      customerId: booking.customerId,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (!isConflict(error)) throw error;
    const existing = await readBookingConfirmation(id, context.tenantId);
    if (!existing) {
      throw new StorageError(
        "The Booking confirmation changed. Retry.",
        409,
      );
    }
    assertConfirmation(existing.document, context, booking);
    return existing.document;
  }

  let conversation: ConversationView | null;
  try {
    conversation = await preferredBookingConversation(context, booking);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "booking-confirmation-routing-failed",
        tenantId: context.tenantId,
        bookingId: booking.id,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return markFailed(confirmation, "DELIVERY");
  }
  if (!conversation) {
    return markFailed(confirmation, "NO_SUPPORTED_CONTACT");
  }

  const messageId = bookingConfirmationMessageId(booking.id);
  confirmation = await replaceBookingConfirmation(
    {
      ...confirmation.document,
      conversationId: conversation.id,
      messageId,
      channel: conversation.channel,
      updatedAt: new Date().toISOString(),
    },
    confirmation.etag,
  );
  try {
    const result = await addConversationMessageForContext(
      context,
      conversation.id,
      {
        direction: "OUTBOUND",
        requestId: messageId,
        body: bookingConfirmationMessage(context, booking),
      },
    );
    const status =
      result.message.deliveryStatus === "SENT"
        ? "SENT"
        : result.message.deliveryStatus === "LOCAL_ONLY"
          ? "LOCAL_ONLY"
          : "FAILED";
    const updated = await replaceBookingConfirmation(
      {
        ...confirmation.document,
        status,
        messageDeliveryStatus: result.message.deliveryStatus,
        ...(status === "FAILED"
          ? { failureCategory: "DELIVERY" as const }
          : {}),
        updatedAt: new Date().toISOString(),
      },
      confirmation.etag,
    );
    return updated.document;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "booking-confirmation-delivery-failed",
        tenantId: context.tenantId,
        bookingId: booking.id,
        conversationId: conversation.id,
        messageId,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return markFailed(confirmation, "DELIVERY");
  }
}
