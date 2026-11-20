import type {
  BookingPage,
  BookingStatus,
  BookingView,
} from "@/server/booking-types";

function isStatus(value: unknown): value is BookingStatus {
  return [
    "PENDING",
    "AWAITING_DEPOSIT",
    "CONFIRMED",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ].includes(String(value));
}

export function isBooking(value: unknown): value is BookingView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "customerId" in value &&
    typeof value.customerId === "string" &&
    "customerName" in value &&
    typeof value.customerName === "string" &&
    "customerStatus" in value &&
    ["active", "archived", "erased"].includes(String(value.customerStatus)) &&
    "serviceId" in value &&
    typeof value.serviceId === "string" &&
    "serviceName" in value &&
    typeof value.serviceName === "string" &&
    "serviceActive" in value &&
    typeof value.serviceActive === "boolean" &&
    ((![
      "staffUserId",
      "staffName",
      "staffUsername",
    ].some((field) => field in value)) ||
      ("staffUserId" in value &&
        typeof value.staffUserId === "string" &&
        "staffName" in value &&
        typeof value.staffName === "string" &&
        "staffUsername" in value &&
        typeof value.staffUsername === "string")) &&
    (!("conversationId" in value) ||
      typeof value.conversationId === "string") &&
    "startAt" in value &&
    typeof value.startAt === "string" &&
    "endAt" in value &&
    typeof value.endAt === "string" &&
    "timeZone" in value &&
    typeof value.timeZone === "string" &&
    "durationMinutes" in value &&
    Number.isSafeInteger(value.durationMinutes) &&
    "status" in value &&
    isStatus(value.status) &&
    "totalAmountMinor" in value &&
    Number.isSafeInteger(value.totalAmountMinor) &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "defaultDepositPercentage" in value &&
    typeof value.defaultDepositPercentage === "number" &&
    Number.isInteger(value.defaultDepositPercentage) &&
    value.defaultDepositPercentage >= 0 &&
    value.defaultDepositPercentage <= 100 &&
    "appliedDepositPercentage" in value &&
    typeof value.appliedDepositPercentage === "number" &&
    Number.isInteger(value.appliedDepositPercentage) &&
    value.appliedDepositPercentage >= 0 &&
    value.appliedDepositPercentage <= 100 &&
    "depositAmountMinor" in value &&
    typeof value.depositAmountMinor === "number" &&
    Number.isSafeInteger(value.depositAmountMinor) &&
    value.depositAmountMinor >= 0 &&
    "depositOverridden" in value &&
    typeof value.depositOverridden === "boolean" &&
    (!value.depositOverridden ||
      ("depositOverriddenByUsername" in value &&
        typeof value.depositOverriddenByUsername === "string" &&
        "depositOverriddenAt" in value &&
        typeof value.depositOverriddenAt === "string")) &&
    ((!("archivedAt" in value) &&
      !("archivedByUserId" in value) &&
      !("archivedByUsername" in value) &&
      !("archivedFromStatus" in value)) ||
      ("archivedAt" in value &&
        typeof value.archivedAt === "string" &&
        "archivedByUserId" in value &&
        typeof value.archivedByUserId === "string" &&
        "archivedByUsername" in value &&
        typeof value.archivedByUsername === "string" &&
        "archivedFromStatus" in value &&
        isStatus(value.archivedFromStatus))) &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

export function parseBookingPage(value: unknown): BookingPage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("bookings" in value) ||
    !Array.isArray(value.bookings) ||
    !value.bookings.every(isBooking) ||
    !("timeZone" in value) ||
    typeof value.timeZone !== "string"
  ) {
    throw new Error("The server returned invalid Booking data.");
  }
  const continuationToken =
    "continuationToken" in value ? value.continuationToken : undefined;
  if (
    continuationToken !== undefined &&
    typeof continuationToken !== "string"
  ) {
    throw new Error("The server returned invalid Booking data.");
  }
  return {
    bookings: value.bookings,
    timeZone: value.timeZone,
    ...(continuationToken ? { continuationToken } : {}),
  };
}

export function parseBookingResponse(value: unknown): BookingView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("booking" in value) ||
    !isBooking(value.booking)
  ) {
    throw new Error("The server returned invalid Booking data.");
  }
  return value.booking;
}

export async function bookingApi(
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
        : "The Booking request could not be completed.",
    );
  }
  return result;
}
