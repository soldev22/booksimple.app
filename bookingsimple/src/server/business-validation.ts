import { z } from "zod";
import {
  MAX_REMINDER_OFFSET_MINUTES,
  MAX_REMINDER_RULES,
  REMINDER_CHANNELS,
  type BusinessReminderRule,
} from "./reminder-types";

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
    defaultDepositPercentage: z.coerce.number().int().min(0).max(100),
    reminderRules: z.preprocess(
      (value) => {
        if (value === undefined) return [];
        if (typeof value !== "string") return value;
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      },
      z
        .array(
          z
            .object({
              channel: z.enum(REMINDER_CHANNELS),
              offsetMinutes: z.coerce
                .number()
                .int()
                .min(1)
                .max(MAX_REMINDER_OFFSET_MINUTES),
            })
            .strict(),
        )
        .max(MAX_REMINDER_RULES)
        .superRefine((rules, context) => {
          const keys = new Set<string>();
          for (const [index, rule] of rules.entries()) {
            const key = `${rule.channel}-${rule.offsetMinutes}`;
            if (keys.has(key)) {
              context.addIssue({
                code: "custom",
                message: "Reminder rules must be unique.",
                path: [index],
              });
            }
            keys.add(key);
          }
        })
        .transform<BusinessReminderRule[]>((rules) =>
          rules.map((rule) => ({
            id: `${rule.channel.toLowerCase()}-${rule.offsetMinutes}`,
            channel: rule.channel,
            offsetMinutes: rule.offsetMinutes,
          })),
        ),
    ),
  })
  .strict();

const invitationEmailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(254))
  .transform((value) => value.toLowerCase());

const createInvitationSchema = z
  .object({ email: invitationEmailSchema })
  .strict();

const deleteInvitationSchema = z
  .object({ email: invitationEmailSchema })
  .strict();

const acceptInvitationSchema = z
  .object({
    token: z.string().min(80).max(300),
  })
  .strict();

export type BusinessUpdateInput = z.infer<typeof businessUpdateSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type DeleteInvitationInput = z.infer<typeof deleteInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export function parseBusinessUpdateInput(input: unknown): BusinessUpdateInput {
  return businessUpdateSchema.parse(input);
}

export function parseCreateInvitationInput(
  input: unknown,
): CreateInvitationInput {
  return createInvitationSchema.parse(input);
}

export function parseDeleteInvitationInput(
  input: unknown,
): DeleteInvitationInput {
  return deleteInvitationSchema.parse(input);
}

export function parseAcceptInvitationInput(
  input: unknown,
): AcceptInvitationInput {
  return acceptInvitationSchema.parse(input);
}
