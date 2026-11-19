import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { TenantContext } from "./auth-types";
import type { BookingDocument } from "./booking-types";
import { preferredBookingConversation } from "./booking-confirmation-service";
import { addConversationMessageForContext } from "./conversation-service";
import { getCustomer } from "./customer-service";
import { configuredMessagingProvider } from "./messaging-service";
import { getService } from "./service-service";

export class ReminderDeliveryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNSUPPORTED_CHANNEL"
      | "NO_SUPPORTED_CONTACT"
      | "DELIVERY",
  ) {
    super(message);
    this.name = "ReminderDeliveryError";
  }
}

export function reminderMessageId(reminderId: string): string {
  const bytes = createHash("sha256")
    .update(`booking-reminder\n${reminderId}`)
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

export function reminderMessage(input: {
  businessName: string;
  customerName: string;
  serviceName: string;
  bookingId: string;
  startAt: string;
  timeZone: string;
  durationMinutes: number;
}): string {
  const parsed = z
    .object({
      businessName: z.string().trim().min(1).max(120),
      customerName: z.string().trim().min(1).max(200),
      serviceName: z.string().trim().min(1).max(200),
      bookingId: z.uuid(),
      startAt: z.iso.datetime({ offset: true }),
      timeZone: z.string().trim().min(1).max(100),
      durationMinutes: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  const start = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: parsed.timeZone,
  }).format(new Date(parsed.startAt));
  return [
    `Hello ${parsed.customerName},`,
    "",
    `This is a reminder about your booking with ${parsed.businessName}.`,
    "",
    `Service: ${parsed.serviceName}`,
    `Date and time: ${start}`,
    `Duration: ${parsed.durationMinutes} minutes`,
    `Booking reference: ${parsed.bookingId}`,
    "",
    "If you need to make a change, reply to this message.",
  ].join("\n");
}

export async function deliverReminder(
  context: TenantContext,
  booking: BookingDocument,
  reminderId: string,
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "META",
): Promise<{
  provider: "MOCK_TEST" | "POSTMARK";
  providerReference?: string;
  conversationId: string;
  messageId: string;
}> {
  if (channel !== "EMAIL") {
    throw new ReminderDeliveryError(
      "The configured reminder channel is not connected.",
      "UNSUPPORTED_CHANNEL",
    );
  }
  const provider = configuredMessagingProvider();
  if (
    provider.provider === "TWILIO" ||
    provider.provider === "META" ||
    !provider.supportedChannels.includes("EMAIL")
  ) {
    throw new ReminderDeliveryError(
      "Email reminder delivery is not configured.",
      "UNSUPPORTED_CHANNEL",
    );
  }
  const [customer, service] = await Promise.all([
    getCustomer(context, booking.customerId),
    getService(context, booking.serviceId),
  ]);
  if (!customer.email) {
    throw new ReminderDeliveryError(
      "The Customer has no supported reminder contact.",
      "NO_SUPPORTED_CONTACT",
    );
  }
  const conversation = await preferredBookingConversation(context, {
    customerId: booking.customerId,
    conversationId: booking.conversationId,
  });
  if (!conversation || conversation.channel !== "EMAIL") {
    throw new ReminderDeliveryError(
      "The Customer has no supported reminder contact.",
      "NO_SUPPORTED_CONTACT",
    );
  }
  const messageId = reminderMessageId(reminderId);
  try {
    const result = await addConversationMessageForContext(
      context,
      conversation.id,
      {
        direction: "OUTBOUND",
        requestId: messageId,
        body: reminderMessage({
          businessName: context.businessName,
          customerName: customer.name,
          serviceName: service.name,
          bookingId: booking.id,
          startAt: booking.startAt,
          timeZone: booking.timeZone,
          durationMinutes: booking.durationMinutes,
        }),
      },
    );
    if (
      result.message.deliveryStatus !== "SENT" &&
      result.message.deliveryStatus !== "LOCAL_ONLY"
    ) {
      throw new ReminderDeliveryError(
        "The reminder message was not delivered.",
        "DELIVERY",
      );
    }
    return {
      provider: provider.provider,
      conversationId: conversation.id,
      messageId,
    };
  } catch (error) {
    if (error instanceof ReminderDeliveryError) throw error;
    throw new ReminderDeliveryError(
      "The reminder message could not be delivered.",
      "DELIVERY",
    );
  }
}
