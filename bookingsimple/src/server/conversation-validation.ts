import { z } from "zod";
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
} from "./conversation-types";
import { normalizePhone } from "./customer-validation";

const channelSchema = z.enum(COMMUNICATION_CHANNELS);
const directionSchema = z.enum(["INBOUND", "OUTBOUND"]);

function normalizeContact(
  channel: CommunicationChannel,
  value: string,
): string {
  const trimmed = value.trim();
  if (channel === "EMAIL") return trimmed.toLowerCase();
  if (channel === "SMS" || channel === "WHATSAPP") {
    return normalizePhone(trimmed);
  }
  return trimmed;
}

function validContact(channel: CommunicationChannel, value: string): boolean {
  if (channel === "EMAIL") return z.email().safeParse(value).success;
  if (channel === "SMS" || channel === "WHATSAPP") {
    return /^\+?\d{7,15}$/.test(value);
  }
  return value.length >= 1 && value.length <= 254;
}

const createConversationSchema = z
  .object({
    channel: channelSchema,
    contactValue: z.string().trim().min(1).max(254),
    contactLabel: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => value || undefined),
    initialMessage: z.string().trim().min(1).max(4_000),
    direction: directionSchema,
  })
  .strict()
  .transform((value, context) => {
    const normalizedContact = normalizeContact(
      value.channel,
      value.contactValue,
    );
    if (!validContact(value.channel, normalizedContact)) {
      context.addIssue({
        code: "custom",
        path: ["contactValue"],
        message: "Contact value is invalid for the selected channel.",
      });
      return z.NEVER;
    }
    return {
      channel: value.channel,
      normalizedContact,
      contactLabel: value.contactLabel ?? value.contactValue.trim(),
      initialMessage: value.initialMessage,
      direction: value.direction,
    };
  });

const createMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(4_000),
    direction: directionSchema,
  })
  .strict();

const linkCustomerSchema = z
  .object({
    customerId: z.uuid(),
  })
  .strict();

const conversationListSchema = z
  .object({
    search: z.string().trim().max(100).default(""),
    continuationToken: z.string().max(8_192).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const messageListSchema = z
  .object({
    messageContinuationToken: z.string().max(8_192).optional(),
    messagePageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const conversationIdSchema = z.uuid();

export type CreateConversationInput = z.infer<
  typeof createConversationSchema
>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type LinkCustomerInput = z.infer<typeof linkCustomerSchema>;
export type ConversationListInput = z.infer<typeof conversationListSchema>;
export type MessageListInput = z.infer<typeof messageListSchema>;

export function parseCreateConversationInput(
  input: unknown,
): CreateConversationInput {
  return createConversationSchema.parse(input);
}

export function parseCreateMessageInput(input: unknown): CreateMessageInput {
  return createMessageSchema.parse(input);
}

export function parseLinkCustomerInput(input: unknown): LinkCustomerInput {
  return linkCustomerSchema.parse(input);
}

export function parseConversationId(input: unknown): string {
  return conversationIdSchema.parse(input);
}

export function parseConversationListInput(
  searchParams: URLSearchParams,
): ConversationListInput {
  return conversationListSchema.parse({
    search: searchParams.get("search") ?? undefined,
    continuationToken: searchParams.get("continuationToken") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
}

export function parseMessageListInput(
  searchParams: URLSearchParams,
): MessageListInput {
  return messageListSchema.parse({
    messageContinuationToken:
      searchParams.get("messageContinuationToken") ?? undefined,
    messagePageSize: searchParams.get("messagePageSize") ?? undefined,
  });
}
