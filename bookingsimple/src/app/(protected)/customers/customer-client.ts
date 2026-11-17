import type {
  CustomerDuplicateWarning,
  CustomerMutationResult,
  CustomerPage,
  CustomerStatus,
  CustomerView,
} from "@/server/customer-types";

function isStatus(value: unknown): value is CustomerStatus {
  return ["active", "archived", "erased"].includes(String(value));
}

export function isCustomer(value: unknown): value is CustomerView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "status" in value &&
    isStatus(value.status) &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    (!("email" in value) || typeof value.email === "string") &&
    (!("phone" in value) || typeof value.phone === "string")
  );
}

function isWarning(value: unknown): value is CustomerDuplicateWarning {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "matchingFields" in value &&
    Array.isArray(value.matchingFields) &&
    value.matchingFields.every((field) => field === "email" || field === "phone")
  );
}

export function parseCustomerPage(value: unknown): CustomerPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("customers" in value) ||
    !Array.isArray(value.customers) ||
    !value.customers.every(isCustomer)
  ) {
    throw new Error("The server returned invalid customer data.");
  }
  const continuationToken =
    "continuationToken" in value ? value.continuationToken : undefined;
  if (
    continuationToken !== undefined &&
    typeof continuationToken !== "string"
  ) {
    throw new Error("The server returned invalid customer data.");
  }
  return {
    customers: value.customers,
    ...(continuationToken ? { continuationToken } : {}),
  };
}

export function parseCustomerResult(value: unknown): CustomerMutationResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("customer" in value) ||
    !isCustomer(value.customer) ||
    !("warnings" in value) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isWarning)
  ) {
    throw new Error("The server returned invalid customer data.");
  }
  return { customer: value.customer, warnings: value.warnings };
}

export function parseCustomerResponse(value: unknown): CustomerView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("customer" in value) ||
    !isCustomer(value.customer)
  ) {
    throw new Error("The server returned invalid customer data.");
  }
  return value.customer;
}

export async function customerApi(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
        : "The customer request could not be completed.",
    );
  }
  return result;
}
