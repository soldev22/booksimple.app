import { z } from "zod";

const createPaymentSchema = z
  .object({
    bookingId: z.uuid(),
    paymentType: z.enum(["DEPOSIT", "BALANCE"]).default("DEPOSIT"),
  })
  .strict();

const paymentListSchema = z
  .object({
    bookingId: z.uuid(),
  })
  .strict();

const mockPaymentConfirmationSchema = z
  .object({
    eventId: z.uuid(),
  })
  .strict();

const paymentIdSchema = z
  .string()
  .regex(/^(deposit|balance)-[0-9a-f-]{36}$/i);

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type MockPaymentConfirmationInput = z.infer<
  typeof mockPaymentConfirmationSchema
>;

export function parseCreatePaymentInput(
  input: unknown,
): CreatePaymentInput {
  return createPaymentSchema.parse(input);
}

export function parsePaymentListInput(
  searchParams: URLSearchParams,
): { bookingId: string } {
  return paymentListSchema.parse({
    bookingId: searchParams.get("bookingId") ?? undefined,
  });
}

export function parseMockPaymentConfirmationInput(
  input: unknown,
): MockPaymentConfirmationInput {
  return mockPaymentConfirmationSchema.parse(input);
}

export function parsePaymentId(input: unknown): string {
  return paymentIdSchema.parse(input);
}
