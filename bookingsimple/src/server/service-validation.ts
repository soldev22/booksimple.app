import { z } from "zod";
import { isCurrencyCode, parsePriceToMinor } from "./money";

const serviceMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z
      .string()
      .trim()
      .max(1_000)
      .optional()
      .transform((value) => value || undefined),
    durationMinutes: z.coerce.number().int().positive().safe(),
    price: z.string().trim().min(1).max(30),
    currency: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(isCurrencyCode),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      parsePriceToMinor(value.price, value.currency);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["price"],
        message: "Price is invalid for the selected currency.",
      });
    }
  })
  .transform(({ price, ...value }) => ({
    ...value,
    priceMinor: parsePriceToMinor(price, value.currency),
  }));

const serviceStatusSchema = z
  .object({
    active: z.boolean(),
  })
  .strict();

const serviceIdSchema = z.uuid();

const serviceSearchSchema = z
  .object({
    search: z.string().trim().max(100).default(""),
    status: z.enum(["active", "inactive", "all"]).default("active"),
    continuationToken: z.string().max(8_192).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type ServiceMutationInput = z.infer<typeof serviceMutationSchema>;
export type ServiceStatusInput = z.infer<typeof serviceStatusSchema>;
export type ServiceSearchInput = z.infer<typeof serviceSearchSchema>;

export function parseServiceMutationInput(
  input: unknown,
): ServiceMutationInput {
  return serviceMutationSchema.parse(input);
}

export function parseServiceStatusInput(input: unknown): ServiceStatusInput {
  return serviceStatusSchema.parse(input);
}

export function parseServiceId(input: unknown): string {
  return serviceIdSchema.parse(input);
}

export function parseServiceSearchInput(
  searchParams: URLSearchParams,
): ServiceSearchInput {
  return serviceSearchSchema.parse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    continuationToken: searchParams.get("continuationToken") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
}
