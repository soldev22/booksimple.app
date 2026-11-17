import { z } from "zod";

const emailSchema = z.email().max(254).transform((email) => email.trim().toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const uuidSchema = z.uuid();
const invitationTokenSchema = z.string().min(80).max(300);

export const authSchemas = {
  register: z
    .object({
      name: z.string().trim().min(2).max(100),
      email: emailSchema,
      password: passwordSchema,
      businessName: z.preprocess(
        (value) =>
          typeof value === "string" && value.trim() === ""
            ? undefined
            : value,
        z.string().trim().min(2).max(120).optional(),
      ),
      invitationToken: invitationTokenSchema.optional(),
    })
    .strict()
    .refine(
      (input) => !(input.businessName && input.invitationToken),
      { path: ["businessName"], message: "An invitation cannot create a new business." },
    ),
  login: z
    .object({
      email: emailSchema,
      password: z.string().min(1).max(128),
      invitationToken: invitationTokenSchema.optional(),
    })
    .strict(),
  verify: z
    .object({
      token: z.string().min(40).max(140),
      invitationToken: invitationTokenSchema.optional(),
    })
    .strict(),
  "request-reset": z.object({ email: emailSchema }).strict(),
  "resend-verification": z.object({ email: emailSchema }).strict(),
  "resubmit-application": z
    .object({ businessName: z.string().trim().min(2).max(120) })
    .strict(),
  reset: z
    .object({
      token: z.string().min(40).max(140),
      password: passwordSchema,
    })
    .strict(),
  "mfa-setup": z.object({}).strict(),
  "mfa-enable": z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
  mfa: z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
  recovery: z.object({ code: z.string().trim().min(16).max(40) }).strict(),
  logout: z.object({}).strict(),
  approve: z.object({ userId: uuidSchema }).strict(),
  reject: z.object({ userId: uuidSchema }).strict(),
  "platform-role": z
    .object({ userId: uuidSchema, enabled: z.boolean() })
    .strict(),
  "account-status": z
    .object({ userId: uuidSchema, paused: z.boolean() })
    .strict(),
  "delete-user": z.object({ userId: uuidSchema }).strict(),
  assign: z
    .object({
      userId: uuidSchema,
      tenantId: uuidSchema,
      username: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/),
      role: z.enum(["company_admin", "company_user"]),
    })
    .strict(),
} as const;

export type AuthAction = keyof typeof authSchemas;
export type AuthInput<Action extends AuthAction> = z.infer<
  (typeof authSchemas)[Action]
>;

export function parseAuthInput<Action extends AuthAction>(
  action: Action,
  input: unknown,
): AuthInput<Action> {
  const schema = authSchemas[action];
  return schema.parse(input) as AuthInput<Action>;
}
