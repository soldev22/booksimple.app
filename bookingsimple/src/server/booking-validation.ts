import { z } from "zod";
import { BOOKING_STATUSES } from "./booking-types";

const optionalId = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((value) => value || undefined);

const bookingMutationSchema = z
  .object({
    customerId: z.uuid(),
    serviceId: z.uuid(),
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    conversationId: optionalId,
  })
  .strict();

const bookingUpdateSchema = z
  .object({
    customerId: z.uuid(),
    serviceId: z.uuid(),
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  })
  .strict();

const bookingStatusSchema = z
  .object({
    status: z.enum(BOOKING_STATUSES),
  })
  .strict();

const bookingListSchema = z
  .object({
    status: z
      .union([z.literal("all"), z.enum(BOOKING_STATUSES)])
      .default("all"),
    customerId: optionalId,
    continuationToken: z.string().max(8_192).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const bookingIdSchema = z.uuid();

export type BookingMutationInput = z.infer<typeof bookingMutationSchema>;
export type BookingUpdateInput = z.infer<typeof bookingUpdateSchema>;
export type BookingStatusInput = z.infer<typeof bookingStatusSchema>;
export type BookingListInput = z.infer<typeof bookingListSchema>;

export function parseBookingMutationInput(
  input: unknown,
): BookingMutationInput {
  return bookingMutationSchema.parse(input);
}

export function parseBookingUpdateInput(input: unknown): BookingUpdateInput {
  return bookingUpdateSchema.parse(input);
}

export function parseBookingStatusInput(input: unknown): BookingStatusInput {
  return bookingStatusSchema.parse(input);
}

export function parseBookingListInput(
  searchParams: URLSearchParams,
): BookingListInput {
  return bookingListSchema.parse({
    status: searchParams.get("status") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    continuationToken: searchParams.get("continuationToken") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
}

export function parseBookingId(input: unknown): string {
  return bookingIdSchema.parse(input);
}
