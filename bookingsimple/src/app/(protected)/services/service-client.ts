import type { ServicePage, ServiceView } from "@/server/service-types";

export function isService(value: unknown): value is ServiceView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    (!("description" in value) || typeof value.description === "string") &&
    "durationMinutes" in value &&
    typeof value.durationMinutes === "number" &&
    Number.isSafeInteger(value.durationMinutes) &&
    "priceMinor" in value &&
    typeof value.priceMinor === "number" &&
    Number.isSafeInteger(value.priceMinor) &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "active" in value &&
    typeof value.active === "boolean" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

export function parseServicePage(value: unknown): ServicePage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("services" in value) ||
    !Array.isArray(value.services) ||
    !value.services.every(isService) ||
    !("defaultCurrency" in value) ||
    typeof value.defaultCurrency !== "string"
  ) {
    throw new Error("The server returned invalid Service data.");
  }
  const continuationToken =
    "continuationToken" in value ? value.continuationToken : undefined;
  if (
    continuationToken !== undefined &&
    typeof continuationToken !== "string"
  ) {
    throw new Error("The server returned invalid Service data.");
  }
  return {
    services: value.services,
    defaultCurrency: value.defaultCurrency,
    ...(continuationToken ? { continuationToken } : {}),
  };
}

export function parseServiceResponse(value: unknown): ServiceView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("service" in value) ||
    !isService(value.service)
  ) {
    throw new Error("The server returned invalid Service data.");
  }
  return value.service;
}

export async function serviceApi(
  endpoint: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "The Service request could not be completed.",
    );
  }
  return result;
}
