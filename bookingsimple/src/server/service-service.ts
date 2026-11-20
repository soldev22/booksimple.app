import "server-only";

import { randomUUID } from "node:crypto";
import { getRequestViewer } from "./auth";
import {
  controlContainer,
  isConflict,
  isPreconditionFailed,
  readDocument,
  StorageError,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import {
  DEFAULT_BUSINESS_CURRENCY,
  type BusinessDocument,
} from "./business-types";
import {
  createServiceDocument,
  queryServicePage,
  readServiceDocument,
  replaceServiceDocument,
} from "./service-storage";
import {
  SERVICE_SCHEMA_VERSION,
  type ServiceDocument,
  type ServicePage,
  type ServiceView,
} from "./service-types";
import type {
  ServiceMutationInput,
  ServiceSearchInput,
} from "./service-validation";
import { isCurrencyCode } from "./money";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

function serviceError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function isServiceDocument(
  document: ServiceDocument,
  id: string,
  tenantId: string,
): boolean {
  return (
    document.id === id &&
    document.tenantId === tenantId &&
    document.type === "service" &&
    document.schemaVersion === SERVICE_SCHEMA_VERSION &&
    typeof document.name === "string" &&
    typeof document.searchName === "string" &&
    (document.description === undefined ||
      typeof document.description === "string") &&
    Number.isSafeInteger(document.durationMinutes) &&
    document.durationMinutes > 0 &&
    Number.isSafeInteger(document.priceMinor) &&
    document.priceMinor >= 0 &&
    typeof document.currency === "string" &&
    isCurrencyCode(document.currency) &&
    typeof document.active === "boolean" &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string"
  );
}

function toServiceView(document: ServiceDocument): ServiceView {
  return {
    id: document.id,
    name: document.name,
    ...(document.description ? { description: document.description } : {}),
    durationMinutes: document.durationMinutes,
    priceMinor: document.priceMinor,
    currency: document.currency,
    active: document.active,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

async function defaultCurrency(context: TenantContext): Promise<string> {
  const business = await readDocument<BusinessDocument>(
    controlContainer(),
    context.tenantId,
    context.tenantId,
  );
  if (
    !business ||
    business.document.type !== "business" ||
    business.document.status !== "active"
  ) {
    throw serviceError(404, "The active business was not found.");
  }
  const currency = business.document.currency ?? DEFAULT_BUSINESS_CURRENCY;
  if (!isCurrencyCode(currency)) {
    throw serviceError(503, "The business currency is invalid.");
  }
  return currency;
}

async function readOwnedService(context: TenantContext, id: string) {
  const result = await readServiceDocument(id, context.tenantId);
  if (!result) throw serviceError(404, "Service not found.");
  if (!isServiceDocument(result.document, id, context.tenantId)) {
    throw serviceError(503, "The service record is invalid.");
  }
  return result;
}

export async function listServices(
  request: Request,
  input: ServiceSearchInput,
): Promise<ServicePage> {
  const context = await contextForRequest(request);
  const parameters: { name: string; value: string | boolean }[] = [
    { name: "@type", value: "service" },
  ];
  const filters = ["c.type = @type"];
  if (input.status !== "all") {
    filters.push("c.active = @active");
    parameters.push({
      name: "@active",
      value: input.status === "active",
    });
  }
  if (input.search) {
    filters.push(
      "(CONTAINS(c.searchName, @search) OR CONTAINS(c.description, @search, true))",
    );
    parameters.push({ name: "@search", value: input.search.toLowerCase() });
  }
  const result = await queryServicePage(
    context.tenantId,
    `SELECT * FROM c WHERE ${filters.join(" AND ")} ORDER BY c.updatedAt DESC`,
    parameters,
    input.continuationToken,
    input.pageSize,
  );
  if (
    result.items.some(
      (service) => !isServiceDocument(service, service.id, context.tenantId),
    )
  ) {
    throw serviceError(503, "The service list contains an invalid record.");
  }
  return {
    services: result.items.map(toServiceView),
    defaultCurrency: await defaultCurrency(context),
    ...(result.continuationToken
      ? { continuationToken: result.continuationToken }
      : {}),
  };
}

export async function getService(
  context: TenantContext,
  id: string,
): Promise<ServiceView> {
  return toServiceView((await readOwnedService(context, id)).document);
}

export async function getServiceForRequest(
  request: Request,
  id: string,
): Promise<ServiceView> {
  return getService(await contextForRequest(request), id);
}

export async function createService(
  request: Request,
  input: ServiceMutationInput,
): Promise<ServiceView> {
  const context = await contextForRequest(request);
  requireCompanyAdmin(context);
  const now = new Date().toISOString();
  const document: ServiceDocument = {
    id: randomUUID(),
    tenantId: context.tenantId,
    type: "service",
    schemaVersion: SERVICE_SCHEMA_VERSION,
    name: input.name,
    searchName: input.name.toLowerCase(),
    ...(input.description ? { description: input.description } : {}),
    durationMinutes: input.durationMinutes,
    priceMinor: input.priceMinor,
    currency: input.currency,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    return toServiceView((await createServiceDocument(document)).document);
  } catch (error) {
    if (isConflict(error)) {
      throw serviceError(409, "The service could not be created. Retry.");
    }
    throw error;
  }
}

export async function updateService(
  request: Request,
  id: string,
  input: ServiceMutationInput,
): Promise<ServiceView> {
  const context = await contextForRequest(request);
  const current = await readOwnedService(context, id);
  const next: ServiceDocument = {
    ...current.document,
    name: input.name,
    searchName: input.name.toLowerCase(),
    ...(input.description
      ? { description: input.description }
      : { description: undefined }),
    durationMinutes: input.durationMinutes,
    priceMinor: input.priceMinor,
    currency: input.currency,
    updatedAt: new Date().toISOString(),
  };
  try {
    return toServiceView(
      (await replaceServiceDocument(next, current.etag)).document,
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw serviceError(409, "The service changed. Refresh and retry.");
    }
    throw error;
  }
}

export async function setServiceActive(
  request: Request,
  id: string,
  active: boolean,
): Promise<ServiceView> {
  const context = await contextForRequest(request);
  const current = await readOwnedService(context, id);
  if (current.document.active === active) return toServiceView(current.document);
  try {
    return toServiceView(
      (
        await replaceServiceDocument(
          {
            ...current.document,
            active,
            updatedAt: new Date().toISOString(),
          },
          current.etag,
        )
      ).document,
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw serviceError(409, "The service changed. Refresh and retry.");
    }
    throw error;
  }
}
