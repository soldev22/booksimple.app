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
  createBookingDocument,
  queryBookingPage,
  readBookingDocument,
  replaceBookingDocument,
} from "./booking-storage";
import { isTimeZone, localDateTimeToUtc } from "./booking-time";
import {
  BOOKING_SCHEMA_VERSION,
  BOOKING_STATUSES,
  type BookingDocument,
  type BookingPage,
  type BookingStatus,
  type BookingView,
} from "./booking-types";
import type {
  BookingListInput,
  BookingMutationInput,
  BookingUpdateInput,
} from "./booking-validation";
import type { BusinessDocument } from "./business-types";
import { getCustomer } from "./customer-service";
import { readConversationDocument } from "./conversation-storage";
import { isCurrencyCode } from "./money";
import { getService } from "./service-service";
import { requireTenantContext } from "./tenant-context";

const NON_EDITABLE_STATUSES: BookingStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

function bookingError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

async function contextForRequest(request: Request): Promise<TenantContext> {
  return requireTenantContext(await getRequestViewer(request));
}

function isBookingDocument(
  document: BookingDocument,
  id: string,
  tenantId: string,
): boolean {
  const startAt = Date.parse(document.startAt);
  const endAt = Date.parse(document.endAt);
  return (
    document.id === id &&
    document.tenantId === tenantId &&
    document.type === "booking" &&
    document.schemaVersion === BOOKING_SCHEMA_VERSION &&
    typeof document.customerId === "string" &&
    typeof document.serviceId === "string" &&
    (document.conversationId === undefined ||
      typeof document.conversationId === "string") &&
    Number.isFinite(startAt) &&
    Number.isFinite(endAt) &&
    endAt > startAt &&
    isTimeZone(document.timeZone) &&
    Number.isSafeInteger(document.durationMinutes) &&
    document.durationMinutes > 0 &&
    BOOKING_STATUSES.includes(document.status) &&
    Number.isSafeInteger(document.totalAmountMinor) &&
    document.totalAmountMinor >= 0 &&
    isCurrencyCode(document.currency) &&
    typeof document.createdAt === "string" &&
    typeof document.updatedAt === "string"
  );
}

async function readOwnedBooking(context: TenantContext, id: string) {
  const result = await readBookingDocument(id, context.tenantId);
  if (!result) throw bookingError(404, "Booking not found.");
  if (!isBookingDocument(result.document, id, context.tenantId)) {
    throw bookingError(503, "The Booking record is invalid.");
  }
  return result;
}

async function bookingTimeZone(context: TenantContext): Promise<string> {
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
    throw bookingError(404, "The active Business was not found.");
  }
  if (
    typeof business.document.timezone !== "string" ||
    !isTimeZone(business.document.timezone)
  ) {
    throw bookingError(503, "The Business timezone is invalid.");
  }
  return business.document.timezone;
}

function startAtFromLocal(startLocal: string, timeZone: string): string {
  try {
    return localDateTimeToUtc(startLocal, timeZone);
  } catch (error) {
    throw bookingError(
      400,
      error instanceof Error ? error.message : "Booking time is invalid.",
    );
  }
}

function endAtFromStart(startAt: string, durationMinutes: number): string {
  const timestamp = Date.parse(startAt) + durationMinutes * 60_000;
  if (!Number.isFinite(timestamp)) {
    throw bookingError(400, "Booking time exceeds the supported range.");
  }
  return new Date(timestamp).toISOString();
}

async function toBookingView(
  context: TenantContext,
  document: BookingDocument,
): Promise<BookingView> {
  const [customer, service] = await Promise.all([
    getCustomer(context, document.customerId),
    getService(context, document.serviceId),
  ]);
  return {
    id: document.id,
    customerId: document.customerId,
    customerName: customer.name,
    customerStatus: customer.status,
    serviceId: document.serviceId,
    serviceName: service.name,
    serviceActive: service.active,
    conversationId: document.conversationId,
    startAt: document.startAt,
    endAt: document.endAt,
    timeZone: document.timeZone,
    durationMinutes: document.durationMinutes,
    status: document.status,
    totalAmountMinor: document.totalAmountMinor,
    currency: document.currency,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

async function validateConversationOrigin(
  context: TenantContext,
  conversationId: string | undefined,
  customerId: string,
): Promise<void> {
  if (!conversationId) return;
  const stored = await readConversationDocument(
    conversationId,
    context.tenantId,
  );
  if (
    !stored ||
    stored.document.type !== "conversation" ||
    stored.document.tenantId !== context.tenantId ||
    stored.document.conversationId !== conversationId
  ) {
    throw bookingError(404, "Conversation not found.");
  }
  if (!stored.document.customerId) {
    throw bookingError(
      409,
      "Resolve the Conversation to a Customer before creating a Booking.",
    );
  }
  if (stored.document.customerId !== customerId) {
    throw bookingError(
      409,
      "The Booking Customer must match the Conversation Customer.",
    );
  }
}

export async function listBookingsForContext(
  context: TenantContext,
  input: BookingListInput,
): Promise<BookingPage> {
  const timeZone = await bookingTimeZone(context);
  const filters = ["c.type = @type"];
  const parameters: { name: string; value: string | number | boolean | null }[] =
    [{ name: "@type", value: "booking" }];
  if (input.status !== "all") {
    filters.push("c.status = @status");
    parameters.push({ name: "@status", value: input.status });
  }
  if (input.customerId) {
    filters.push("c.customerId = @customerId");
    parameters.push({ name: "@customerId", value: input.customerId });
  }
  const result = await queryBookingPage(
    context.tenantId,
    `SELECT * FROM c WHERE ${filters.join(" AND ")} ORDER BY c.startAt DESC`,
    parameters,
    input.continuationToken,
    input.pageSize,
  );
  if (
    result.items.some(
      (booking) =>
        !isBookingDocument(booking, booking.id, context.tenantId),
    )
  ) {
    throw bookingError(503, "The Booking list contains an invalid record.");
  }
  return {
    bookings: await Promise.all(
      result.items.map((booking) => toBookingView(context, booking)),
    ),
    timeZone,
    continuationToken: result.continuationToken,
  };
}

export async function listBookings(
  request: Request,
  input: BookingListInput,
): Promise<BookingPage> {
  return listBookingsForContext(await contextForRequest(request), input);
}

export async function getBooking(
  context: TenantContext,
  id: string,
): Promise<BookingView> {
  const current = await readOwnedBooking(context, id);
  return toBookingView(context, current.document);
}

export async function getBookingForRequest(
  request: Request,
  id: string,
): Promise<BookingView> {
  return getBooking(await contextForRequest(request), id);
}

export async function createBooking(
  request: Request,
  input: BookingMutationInput,
): Promise<BookingView> {
  const context = await contextForRequest(request);
  const [customer, service, timeZone] = await Promise.all([
    getCustomer(context, input.customerId),
    getService(context, input.serviceId),
    bookingTimeZone(context),
    validateConversationOrigin(
      context,
      input.conversationId,
      input.customerId,
    ),
  ]);
  if (customer.status !== "active") {
    throw bookingError(409, "Only an active Customer can be booked.");
  }
  if (!service.active) {
    throw bookingError(409, "Only an active Service can be booked.");
  }
  const startAt = startAtFromLocal(input.startLocal, timeZone);
  const now = new Date().toISOString();
  const document: BookingDocument = {
    id: randomUUID(),
    tenantId: context.tenantId,
    type: "booking",
    schemaVersion: BOOKING_SCHEMA_VERSION,
    customerId: input.customerId,
    serviceId: input.serviceId,
    conversationId: input.conversationId,
    startAt,
    endAt: endAtFromStart(startAt, service.durationMinutes),
    timeZone,
    durationMinutes: service.durationMinutes,
    status: "PENDING",
    totalAmountMinor: service.priceMinor,
    currency: service.currency,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const created = await createBookingDocument(document);
    return toBookingView(context, created.document);
  } catch (error) {
    if (isConflict(error)) {
      throw bookingError(409, "The Booking could not be created. Retry.");
    }
    throw error;
  }
}

export async function updateBooking(
  request: Request,
  id: string,
  input: BookingUpdateInput,
): Promise<BookingView> {
  const context = await contextForRequest(request);
  const current = await readOwnedBooking(context, id);
  if (NON_EDITABLE_STATUSES.includes(current.document.status)) {
    throw bookingError(
      409,
      "Completed, cancelled and no-show Bookings cannot be edited.",
    );
  }
  const [customer, service] = await Promise.all([
    getCustomer(context, input.customerId),
    getService(context, input.serviceId),
  ]);
  if (
    input.customerId !== current.document.customerId &&
    customer.status !== "active"
  ) {
    throw bookingError(409, "Only an active Customer can be booked.");
  }
  if (
    input.serviceId !== current.document.serviceId &&
    !service.active
  ) {
    throw bookingError(409, "Only an active Service can be booked.");
  }
  if (
    current.document.conversationId &&
    input.customerId !== current.document.customerId
  ) {
    await validateConversationOrigin(
      context,
      current.document.conversationId,
      input.customerId,
    );
  }
  const startAt = startAtFromLocal(
    input.startLocal,
    current.document.timeZone,
  );
  const serviceChanged = input.serviceId !== current.document.serviceId;
  const durationMinutes = serviceChanged
    ? service.durationMinutes
    : current.document.durationMinutes;
  const next: BookingDocument = {
    ...current.document,
    customerId: input.customerId,
    serviceId: input.serviceId,
    startAt,
    endAt: endAtFromStart(startAt, durationMinutes),
    durationMinutes,
    totalAmountMinor: serviceChanged
      ? service.priceMinor
      : current.document.totalAmountMinor,
    currency: serviceChanged
      ? service.currency
      : current.document.currency,
    updatedAt: new Date().toISOString(),
  };
  try {
    const updated = await replaceBookingDocument(next, current.etag);
    return toBookingView(context, updated.document);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw bookingError(409, "The Booking changed. Refresh and retry.");
    }
    throw error;
  }
}

export async function setBookingStatus(
  request: Request,
  id: string,
  status: BookingStatus,
): Promise<BookingView> {
  const context = await contextForRequest(request);
  const current = await readOwnedBooking(context, id);
  if (current.document.status === status) {
    return toBookingView(context, current.document);
  }
  if (NON_EDITABLE_STATUSES.includes(current.document.status)) {
    throw bookingError(
      409,
      "Completed, cancelled and no-show Booking statuses are final.",
    );
  }
  try {
    const updated = await replaceBookingDocument(
      {
        ...current.document,
        status,
        updatedAt: new Date().toISOString(),
      },
      current.etag,
    );
    return toBookingView(context, updated.document);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw bookingError(409, "The Booking changed. Refresh and retry.");
    }
    throw error;
  }
}
