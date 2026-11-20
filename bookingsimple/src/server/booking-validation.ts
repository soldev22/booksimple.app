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
    staffUserId: optionalId,
  })
  .strict();

const bookingUpdateSchema = z
  .object({
    customerId: z.uuid(),
    serviceId: z.uuid(),
    startLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    staffUserId: z.union([z.uuid(), z.null()]).optional(),
  })
  .strict();

const bookingStatusSchema = z
  .object({
    status: z.enum(BOOKING_STATUSES),
  })
  .strict();

const bookingDepositOverrideSchema = z
  .object({
    percentage: z.coerce.number().int().min(0).max(100),
  })
  .strict();

const bookingArchiveSchema = z
  .object({
    archived: z.boolean(),
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
    startAtFrom: z.string().datetime({ offset: true }).optional(),
    startAtTo: z.string().datetime({ offset: true }).optional(),
    archive: z.enum(["active", "archived"]).default("active"),
  })
  .strict()
  .superRefine((input, context) => {
    if (Boolean(input.startAtFrom) !== Boolean(input.startAtTo)) {
      context.addIssue({
        code: "custom",
        message: "Both Booking range boundaries are required.",
      });
      return;
    }
    if (!input.startAtFrom || !input.startAtTo) return;
    const rangeMilliseconds =
      Date.parse(input.startAtTo) - Date.parse(input.startAtFrom);
    if (
      rangeMilliseconds <= 0 ||
      rangeMilliseconds > 32 * 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Booking ranges must be positive and no longer than 32 days.",
      });
    }
  });

const bookingIdSchema = z.uuid();

export type BookingMutationInput = z.infer<typeof bookingMutationSchema>;
export type BookingUpdateInput = z.infer<typeof bookingUpdateSchema>;
export type BookingStatusInput = z.infer<typeof bookingStatusSchema>;
export type BookingDepositOverrideInput = z.infer<
  typeof bookingDepositOverrideSchema
>;
export type BookingArchiveInput = z.infer<typeof bookingArchiveSchema>;
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

export function parseBookingDepositOverrideInput(
  input: unknown,
): BookingDepositOverrideInput {
  return bookingDepositOverrideSchema.parse(input);
}

export function parseBookingArchiveInput(input: unknown): BookingArchiveInput {
  return bookingArchiveSchema.parse(input);
}

export function parseBookingListInput(
  searchParams: URLSearchParams,
): BookingListInput {
  return bookingListSchema.parse({
    status: searchParams.get("status") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    continuationToken: searchParams.get("continuationToken") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
    startAtFrom: searchParams.get("startAtFrom") ?? undefined,
    startAtTo: searchParams.get("startAtTo") ?? undefined,
    archive: searchParams.get("archive") ?? undefined,
  });
}

export function parseBookingId(input: unknown): string {
  return bookingIdSchema.parse(input);
}
