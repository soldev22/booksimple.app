import { z } from "zod";
import type { CustomerStatus } from "./customer-types";

function optionalEmail() {
  return z
    .string()
    .trim()
    .max(254)
    .transform((value) => value.toLowerCase())
    .refine((value) => value === "" || z.email().safeParse(value).success)
    .transform((value) => value || undefined);
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return `${leadingPlus ? "+" : ""}${digits}`;
}

const customerMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: optionalEmail(),
    phone: z
      .string()
      .trim()
      .max(40)
      .transform(normalizePhone)
      .refine(
        (value) => value === "" || /^\+?\d{7,15}$/.test(value),
        "Phone numbers must contain 7 to 15 digits and may start with +.",
      )
      .transform((value) => value || undefined),
  })
  .strict();

const eraseCustomerSchema = z
  .object({
    confirmation: z.literal("ERASE"),
  })
  .strict();

const customerIdSchema = z.uuid();

const customerSearchSchema = z
  .object({
    search: z.string().trim().max(100).default(""),
    status: z
      .enum(["active", "archived", "erased", "all"])
      .default("active"),
    continuationToken: z.string().max(8_192).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type CustomerMutationInput = z.infer<typeof customerMutationSchema>;
export type EraseCustomerInput = z.infer<typeof eraseCustomerSchema>;
export type CustomerSearchInput = {
  search: string;
  status: CustomerStatus | "all";
  continuationToken?: string;
  pageSize: number;
};

export function parseCustomerMutationInput(
  input: unknown,
): CustomerMutationInput {
  return customerMutationSchema.parse(input);
}

export function parseEraseCustomerInput(input: unknown): EraseCustomerInput {
  return eraseCustomerSchema.parse(input);
}

export function parseCustomerId(input: unknown): string {
  return customerIdSchema.parse(input);
}

export function parseCustomerSearchInput(
  searchParams: URLSearchParams,
): CustomerSearchInput {
  return customerSearchSchema.parse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    continuationToken: searchParams.get("continuationToken") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
}
