import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) {
    return false;
  }
  try {
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: value,
    }).format(0);
    return true;
  } catch {
    return false;
  }
}

const businessUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    timezone: z.string().trim().min(1).max(100).refine(isTimeZone),
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(isCurrency),
  })
  .strict();

const createInvitationSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email().max(254))
      .transform((value) => value.toLowerCase()),
  })
  .strict();

const acceptInvitationSchema = z
  .object({
    token: z.string().min(80).max(300),
  })
  .strict();

export type BusinessUpdateInput = z.infer<typeof businessUpdateSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export function parseBusinessUpdateInput(input: unknown): BusinessUpdateInput {
  return businessUpdateSchema.parse(input);
}

export function parseCreateInvitationInput(
  input: unknown,
): CreateInvitationInput {
  return createInvitationSchema.parse(input);
}

export function parseAcceptInvitationInput(
  input: unknown,
): AcceptInvitationInput {
  return acceptInvitationSchema.parse(input);
}
