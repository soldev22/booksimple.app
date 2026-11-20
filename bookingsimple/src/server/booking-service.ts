import "server-only";

import { randomUUID } from "node:crypto";
import { getRequestViewer } from "./auth";
import { getTenantStaffSnapshot } from "./auth-service";
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
import { ensureBookingConfirmation } from "./booking-confirmation-service";
import {
  isTimeZone,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from "./booking-time";
import {
  BOOKING_SCHEMA_VERSION,
  BOOKING_STATUSES,
  type BookingDocument,
  type BookingPage,
  type BookingStatus,
  type BookingView,
} from "./booking-types";
import type {
  BookingDepositOverrideInput,
  BookingListInput,
  BookingMutationInput,
  BookingUpdateInput,
} from "./booking-validation";
import {
  DEFAULT_DEPOSIT_PERCENTAGE,
  type BusinessDocument,
} from "./business-types";
import { getCustomer } from "./customer-service";
import { readConversationDocument } from "./conversation-storage";
import {
  calculatePercentageAmountMinor,
  isCurrencyCode,
} from "./money";
import { queryBookingPayments } from "./payment-storage";
import { getService } from "./service-service";
import {
  cancelBookingReminders,
  createBookingReminders,
  deleteBookingReminders,
  rescheduleBookingReminders,
} from "./reminder-service";
import { requireCompanyAdmin, requireTenantContext } from "./tenant-context";

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
    ((document.staffUserId === undefined &&
      document.staffName === undefined &&
      document.staffUsername === undefined) ||
      (typeof document.staffUserId === "string" &&
        typeof document.staffName === "string" &&
        typeof document.staffUsername === "string")) &&
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
    Number.isInteger(document.defaultDepositPercentage) &&
    document.defaultDepositPercentage >= 0 &&
    document.defaultDepositPercentage <= 100 &&
    Number.isInteger(document.appliedDepositPercentage) &&
    document.appliedDepositPercentage >= 0 &&
    document.appliedDepositPercentage <= 100 &&
    Number.isSafeInteger(document.depositAmountMinor) &&
    document.depositAmountMinor >= 0 &&
    document.depositAmountMinor ===
      calculatePercentageAmountMinor(
        document.totalAmountMinor,
        document.appliedDepositPercentage,
      ) &&
    typeof document.depositOverridden === "boolean" &&
    (document.depositOverridden
      ? typeof document.depositOverriddenByUserId === "string" &&
        typeof document.depositOverriddenByUsername === "string" &&
        typeof document.depositOverriddenAt === "string"
      : document.depositOverriddenByUserId === undefined &&
        document.depositOverriddenByUsername === undefined &&
        document.depositOverriddenAt === undefined) &&
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

async function bookingBusiness(
  context: TenantContext,
): Promise<BusinessDocument> {
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
  return business.document;
}

function businessTimeZone(business: BusinessDocument): string {
  if (typeof business.timezone !== "string" || !isTimeZone(business.timezone)) {
    throw bookingError(503, "The Business timezone is invalid.");
  }
  return business.timezone;
}

function businessDepositPercentage(business: BusinessDocument): number {
  const percentage =
    business.defaultDepositPercentage ?? DEFAULT_DEPOSIT_PERCENTAGE;
  if (
    !Number.isInteger(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw bookingError(
      503,
      "The Business default deposit percentage is invalid.",
    );
  }
  return percentage;
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
    staffUserId: document.staffUserId,
    staffName: document.staffName,
    staffUsername: document.staffUsername,
    conversationId: document.conversationId,
    startAt: document.startAt,
    endAt: document.endAt,
    timeZone: document.timeZone,
    durationMinutes: document.durationMinutes,
    status: document.status,
    totalAmountMinor: document.totalAmountMinor,
    currency: document.currency,
    defaultDepositPercentage: document.defaultDepositPercentage,
    appliedDepositPercentage: document.appliedDepositPercentage,
    depositAmountMinor: document.depositAmountMinor,
    depositOverridden: document.depositOverridden,
    depositOverriddenByUsername: document.depositOverriddenByUsername,
    depositOverriddenAt: document.depositOverriddenAt,
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
  const timeZone = businessTimeZone(await bookingBusiness(context));
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
  if (input.startAtFrom && input.startAtTo) {
    filters.push("c.startAt >= @startAtFrom", "c.startAt < @startAtTo");
    parameters.push(
      { name: "@startAtFrom", value: input.startAtFrom },
      { name: "@startAtTo", value: input.startAtTo },
    );
  }
  const order = input.startAtFrom ? "ASC" : "DESC";
  const result = await queryBookingPage(
    context.tenantId,
    `SELECT * FROM c WHERE ${filters.join(" AND ")} ORDER BY c.startAt ${order}`,
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

export async function getBookingCalendarContext(
  context: TenantContext,
  now = new Date(),
): Promise<{ localDate: string; timeZone: string }> {
  const timeZone = businessTimeZone(await bookingBusiness(context));
  return {
    localDate: utcToLocalDateTime(now.toISOString(), timeZone).slice(0, 10),
    timeZone,
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
  if (input.staffUserId) requireCompanyAdmin(context);
  const [customer, service, business, , staff] = await Promise.all([
    getCustomer(context, input.customerId),
    getService(context, input.serviceId),
    bookingBusiness(context),
    validateConversationOrigin(
      context,
      input.conversationId,
      input.customerId,
    ),
    input.staffUserId
      ? getTenantStaffSnapshot(context, input.staffUserId)
      : undefined,
  ]);
  const timeZone = businessTimeZone(business);
  const defaultDepositPercentage = businessDepositPercentage(business);
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
    ...(staff ?? {}),
    conversationId: input.conversationId,
    startAt,
    endAt: endAtFromStart(startAt, service.durationMinutes),
    timeZone,
    durationMinutes: service.durationMinutes,
    status: "PENDING",
    totalAmountMinor: service.priceMinor,
    currency: service.currency,
    defaultDepositPercentage,
    appliedDepositPercentage: defaultDepositPercentage,
    depositAmountMinor: calculatePercentageAmountMinor(
      service.priceMinor,
      defaultDepositPercentage,
    ),
    depositOverridden: false,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await createBookingReminders(document, business.reminderRules ?? []);
    const created = await createBookingDocument(document);
    return toBookingView(context, created.document);
  } catch (error) {
    await deleteBookingReminders(context.tenantId, document.id).catch(
      (cleanupError) => {
        console.error({
          event: "booking-reminder-rollback-failed",
          bookingId: document.id,
          error:
            cleanupError instanceof Error
              ? cleanupError.name
              : "UnknownError",
        });
      },
    );
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
  const staffChangeRequested = input.staffUserId !== undefined;
  if (staffChangeRequested) requireCompanyAdmin(context);
  const current = await readOwnedBooking(context, id);
  if (NON_EDITABLE_STATUSES.includes(current.document.status)) {
    throw bookingError(
      409,
      "Completed, cancelled and no-show Bookings cannot be edited.",
    );
  }
  const [customer, service, staff] = await Promise.all([
    getCustomer(context, input.customerId),
    getService(context, input.serviceId),
    typeof input.staffUserId === "string"
      ? getTenantStaffSnapshot(context, input.staffUserId)
      : undefined,
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
  if (
    serviceChanged &&
    (await queryBookingPayments(context.tenantId, id)).some(
      (payment) =>
        payment.paymentType === "DEPOSIT" &&
        (payment.status === "PENDING" || payment.status === "PAID"),
    )
  ) {
    throw bookingError(
      409,
      "The Service cannot change after a deposit Payment request exists.",
    );
  }
  const durationMinutes = serviceChanged
    ? service.durationMinutes
    : current.document.durationMinutes;
  const totalAmountMinor = serviceChanged
    ? service.priceMinor
    : current.document.totalAmountMinor;
  const next: BookingDocument = {
    ...current.document,
    customerId: input.customerId,
    serviceId: input.serviceId,
    ...(staffChangeRequested
      ? staff ?? {
          staffUserId: undefined,
          staffName: undefined,
          staffUsername: undefined,
        }
      : {}),
    startAt,
    endAt: endAtFromStart(startAt, durationMinutes),
    durationMinutes,
    totalAmountMinor,
    currency: serviceChanged
      ? service.currency
      : current.document.currency,
    depositAmountMinor: calculatePercentageAmountMinor(
      totalAmountMinor,
      current.document.appliedDepositPercentage,
    ),
    updatedAt: new Date().toISOString(),
  };
  try {
    const updated = await replaceBookingDocument(next, current.etag);
    await rescheduleBookingReminders(updated.document);
    return toBookingView(context, updated.document);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw bookingError(409, "The Booking changed. Refresh and retry.");
    }
    throw error;
  }
}

export async function overrideBookingDeposit(
  request: Request,
  id: string,
  input: BookingDepositOverrideInput,
): Promise<BookingView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  const current = await readOwnedBooking(context, id);
  if (NON_EDITABLE_STATUSES.includes(current.document.status)) {
    throw bookingError(
      409,
      "Completed, cancelled and no-show Booking deposits cannot be changed.",
    );
  }
  if (
    (await queryBookingPayments(context.tenantId, id)).some(
      (payment) =>
        payment.paymentType === "DEPOSIT" &&
        (payment.status === "PENDING" || payment.status === "PAID"),
    )
  ) {
    throw bookingError(
      409,
      "Deposit terms cannot change after a Payment request exists.",
    );
  }
  if (!viewer) {
    throw bookingError(401, "Sign in is required.");
  }
  const now = new Date().toISOString();
  try {
    const updated = await replaceBookingDocument(
      {
        ...current.document,
        appliedDepositPercentage: input.percentage,
        depositAmountMinor: calculatePercentageAmountMinor(
          current.document.totalAmountMinor,
          input.percentage,
        ),
        depositOverridden: true,
        depositOverriddenByUserId: viewer.user.id,
        depositOverriddenByUsername: context.username,
        depositOverriddenAt: now,
        updatedAt: now,
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

async function transitionBookingForPayment(
  context: TenantContext,
  id: string,
  target: "AWAITING_DEPOSIT" | "CONFIRMED",
): Promise<BookingView> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readOwnedBooking(context, id);
    if (current.document.status === target) {
      const booking = await toBookingView(context, current.document);
      if (target === "CONFIRMED") {
        await ensureBookingConfirmation(context, booking);
      }
      return booking;
    }
    if (NON_EDITABLE_STATUSES.includes(current.document.status)) {
      return toBookingView(context, current.document);
    }
    if (
      target === "AWAITING_DEPOSIT" &&
      current.document.status !== "PENDING"
    ) {
      throw bookingError(
        409,
        "The Booking is not ready for a deposit Payment request.",
      );
    }
    try {
      const updated = await replaceBookingDocument(
        {
          ...current.document,
          status: target,
          updatedAt: new Date().toISOString(),
        },
        current.etag,
      );
      const booking = await toBookingView(context, updated.document);
      if (target === "CONFIRMED") {
        await ensureBookingConfirmation(context, booking);
      }
      return booking;
    } catch (error) {
      if (isPreconditionFailed(error)) continue;
      throw error;
    }
  }
  throw bookingError(409, "The Booking changed. Refresh and retry.");
}

export async function markBookingAwaitingDeposit(
  context: TenantContext,
  id: string,
): Promise<BookingView> {
  return transitionBookingForPayment(context, id, "AWAITING_DEPOSIT");
}

export async function confirmBookingFromPaidDeposit(
  context: TenantContext,
  id: string,
): Promise<BookingView> {
  return transitionBookingForPayment(context, id, "CONFIRMED");
}

export async function setBookingStatus(
  request: Request,
  id: string,
  status: BookingStatus,
): Promise<BookingView> {
  const context = await contextForRequest(request);
  const current = await readOwnedBooking(context, id);
  if (current.document.status === status) {
    if (NON_EDITABLE_STATUSES.includes(status)) {
      await cancelBookingReminders(context.tenantId, id);
    }
    const booking = await toBookingView(context, current.document);
    if (status === "CONFIRMED") {
      await ensureBookingConfirmation(context, booking);
    }
    return booking;
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
    if (NON_EDITABLE_STATUSES.includes(status)) {
      await cancelBookingReminders(context.tenantId, id);
    }
    const booking = await toBookingView(context, updated.document);
    if (status === "CONFIRMED") {
      await ensureBookingConfirmation(context, booking);
    }
    return booking;
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw bookingError(409, "The Booking changed. Refresh and retry.");
    }
    throw error;
  }
}
