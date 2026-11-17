import "server-only";

import { randomUUID } from "node:crypto";
import { getRequestViewer } from "./auth";
import {
  isConflict,
  isPreconditionFailed,
  StorageError,
} from "./auth-storage";
import type { TenantContext, Viewer } from "./auth-types";
import {
  CUSTOMER_SCHEMA_VERSION,
  type CustomerDocument,
  type CustomerDuplicateWarning,
  type CustomerMutationResult,
  type CustomerPage,
  type CustomerProfileDocument,
  type CustomerView,
} from "./customer-types";
import type {
  CustomerMutationInput,
  CustomerSearchInput,
} from "./customer-validation";
import { normalizePhone } from "./customer-validation";
import {
  createCustomerDocument,
  queryCustomerPage,
  readCustomerDocument,
  replaceCustomerDocument,
} from "./customer-storage";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

function customerError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function isCustomerDocument(
  document: CustomerDocument,
  id: string,
  tenantId: string,
): boolean {
  const baseIsValid =
    document.id === id &&
    document.tenantId === tenantId &&
    document.type === "customer" &&
    document.schemaVersion === CUSTOMER_SCHEMA_VERSION &&
    ["active", "archived", "erased"].includes(document.status) &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string";
  if (!baseIsValid) return false;
  return document.status === "erased"
    ? typeof document.erasedAt === "string"
    : typeof document.name === "string" &&
        typeof document.searchName === "string";
}

function toCustomerView(document: CustomerDocument): CustomerView {
  return {
    id: document.id,
    name: document.status === "erased" ? "Erased customer" : document.name,
    ...(document.status !== "erased" && document.email
      ? { email: document.email }
      : {}),
    ...(document.status !== "erased" && document.phone
      ? { phone: document.phone }
      : {}),
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

async function duplicateWarnings(
  context: TenantContext,
  input: CustomerMutationInput,
  excludedId?: string,
): Promise<CustomerDuplicateWarning[]> {
  if (!input.email && !input.phone) return [];
  const predicates: string[] = [];
  const parameters: { name: string; value: string }[] = [
    { name: "@type", value: "customer" },
    { name: "@erased", value: "erased" },
  ];
  if (input.email) {
    predicates.push("c.email = @email");
    parameters.push({ name: "@email", value: input.email });
  }
  if (input.phone) {
    predicates.push("c.phone = @phone");
    parameters.push({ name: "@phone", value: input.phone });
  }
  if (excludedId) {
    parameters.push({ name: "@excludedId", value: excludedId });
  }
  const result = await queryCustomerPage<CustomerProfileDocument>(
    context.tenantId,
    [
      "SELECT TOP 10 c.id, c.tenantId, c.type, c.schemaVersion, c.name, c.searchName, c.email, c.phone, c.status, c.createdAt, c.updatedAt",
      "FROM c",
      "WHERE c.type = @type AND c.status != @erased",
      excludedId ? "AND c.id != @excludedId" : "",
      `AND (${predicates.join(" OR ")})`,
    ]
      .filter(Boolean)
      .join(" "),
    parameters,
    undefined,
    10,
  );
  return result.items.map((customer) => ({
    id: customer.id,
    name: customer.name,
    matchingFields: [
      ...(input.email && customer.email === input.email
        ? (["email"] as const)
        : []),
      ...(input.phone && customer.phone === input.phone
        ? (["phone"] as const)
        : []),
    ],
  }));
}

async function readOwnedCustomer(
  context: TenantContext,
  id: string,
) {
  const result = await readCustomerDocument(id, context.tenantId);
  if (!result) {
    throw customerError(404, "Customer not found.");
  }
  if (!isCustomerDocument(result.document, id, context.tenantId)) {
    throw customerError(503, "The customer record is invalid.");
  }
  return result;
}

export async function listCustomers(
  request: Request,
  input: CustomerSearchInput,
): Promise<CustomerPage> {
  const context = await contextForRequest(request);
  const parameters: { name: string; value: string }[] = [
    { name: "@type", value: "customer" },
  ];
  const filters = ["c.type = @type"];
  if (input.status !== "all") {
    filters.push("c.status = @status");
    parameters.push({ name: "@status", value: input.status });
  }
  if (input.search) {
    const search = input.search.toLowerCase();
    const phoneSearch = normalizePhone(input.search);
    const searchPredicates = [
      "CONTAINS(c.searchName, @search)",
      "CONTAINS(c.email, @search)",
    ];
    parameters.push({ name: "@search", value: search });
    if (phoneSearch.replace("+", "").length >= 3) {
      searchPredicates.push("CONTAINS(c.phone, @phoneSearch)");
      parameters.push({ name: "@phoneSearch", value: phoneSearch });
    }
    filters.push(`(${searchPredicates.join(" OR ")})`);
  }
  const result = await queryCustomerPage<CustomerDocument>(
    context.tenantId,
    `SELECT * FROM c WHERE ${filters.join(" AND ")} ORDER BY c.updatedAt DESC`,
    parameters,
    input.continuationToken,
    input.pageSize,
  );
  if (
    result.items.some(
      (customer) =>
        !isCustomerDocument(customer, customer.id, context.tenantId),
    )
  ) {
    throw customerError(503, "The customer list contains an invalid record.");
  }
  return {
    customers: result.items.map(toCustomerView),
    ...(result.continuationToken
      ? { continuationToken: result.continuationToken }
      : {}),
  };
}

export async function getCustomer(
  context: TenantContext,
  id: string,
): Promise<CustomerView> {
  return toCustomerView((await readOwnedCustomer(context, id)).document);
}

export async function getCustomerForRequest(
  request: Request,
  id: string,
): Promise<CustomerView> {
  return getCustomer(await contextForRequest(request), id);
}

export async function createCustomer(
  request: Request,
  input: CustomerMutationInput,
): Promise<CustomerMutationResult> {
  const context = await contextForRequest(request);
  const warnings = await duplicateWarnings(context, input);
  const now = new Date().toISOString();
  const document: CustomerProfileDocument = {
    id: randomUUID(),
    tenantId: context.tenantId,
    type: "customer",
    schemaVersion: CUSTOMER_SCHEMA_VERSION,
    name: input.name,
    searchName: input.name.toLowerCase(),
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  try {
    const created = await createCustomerDocument(document);
    return { customer: toCustomerView(created.document), warnings };
  } catch (error) {
    if (isConflict(error)) {
      throw customerError(409, "The customer could not be created. Retry.");
    }
    throw error;
  }
}

export async function updateCustomer(
  request: Request,
  id: string,
  input: CustomerMutationInput,
): Promise<CustomerMutationResult> {
  const context = await contextForRequest(request);
  const current = await readOwnedCustomer(context, id);
  if (current.document.status !== "active") {
    throw customerError(409, "Only active customers can be edited.");
  }
  const warnings = await duplicateWarnings(context, input, id);
  const next: CustomerProfileDocument = {
    ...current.document,
    name: input.name,
    searchName: input.name.toLowerCase(),
    ...(input.email ? { email: input.email } : { email: undefined }),
    ...(input.phone ? { phone: input.phone } : { phone: undefined }),
    updatedAt: new Date().toISOString(),
  };
  try {
    const updated = await replaceCustomerDocument(next, current.etag);
    return { customer: toCustomerView(updated.document), warnings };
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw customerError(409, "The customer changed. Refresh and retry.");
    }
    throw error;
  }
}

export async function archiveCustomer(
  request: Request,
  id: string,
): Promise<CustomerView> {
  const context = await contextForRequest(request);
  const current = await readOwnedCustomer(context, id);
  if (current.document.status !== "active") {
    throw customerError(409, "Only active customers can be archived.");
  }
  const now = new Date().toISOString();
  try {
    const updated = await replaceCustomerDocument(
      {
        ...current.document,
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      },
      current.etag,
    );
    return toCustomerView(updated.document);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw customerError(409, "The customer changed. Refresh and retry.");
    }
    throw error;
  }
}

export async function eraseCustomer(
  request: Request,
  id: string,
): Promise<CustomerView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  const current = await readOwnedCustomer(context, id);
  if (current.document.status === "erased") {
    throw customerError(409, "This customer has already been erased.");
  }
  const now = new Date().toISOString();
  try {
    const updated = await replaceCustomerDocument(
      {
        id: current.document.id,
        tenantId: current.document.tenantId,
        type: "customer",
        schemaVersion: CUSTOMER_SCHEMA_VERSION,
        status: "erased",
        createdAt: current.document.createdAt,
        updatedAt: now,
        erasedAt: now,
      },
      current.etag,
    );
    return toCustomerView(updated.document);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw customerError(409, "The customer changed. Refresh and retry.");
    }
    throw error;
  }
}

export function canPermanentlyEraseCustomers(viewer: Viewer): boolean {
  return viewer.tenant?.role === "company_admin";
}
