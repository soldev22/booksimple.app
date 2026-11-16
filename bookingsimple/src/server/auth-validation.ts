import { z } from "zod";

const emailSchema = z.email().max(254).transform((email) => email.trim().toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const uuidSchema = z.uuid();

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
    })
    .strict(),
  login: z
    .object({
      email: emailSchema,
      password: z.string().min(1).max(128),
    })
    .strict(),
  verify: z.object({ token: z.string().min(40).max(140) }).strict(),
  "request-reset": z.object({ email: emailSchema }).strict(),
  "resend-verification": z.object({ email: emailSchema }).strict(),
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
