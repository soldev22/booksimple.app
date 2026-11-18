import type {
  PaymentRequestView,
  PaymentStatus,
  PaymentType,
  PaymentView,
} from "@/server/payment-types";

function isPaymentType(value: unknown): value is PaymentType {
  return ["DEPOSIT", "BALANCE", "FULL_PAYMENT"].includes(String(value));
}

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return ["PENDING", "PAID", "FAILED", "REFUNDED"].includes(String(value));
}

function isPayment(value: unknown): value is PaymentView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "bookingId" in value &&
    typeof value.bookingId === "string" &&
    "paymentType" in value &&
    isPaymentType(value.paymentType) &&
    "amountMinor" in value &&
    typeof value.amountMinor === "number" &&
    Number.isSafeInteger(value.amountMinor) &&
    value.amountMinor > 0 &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "status" in value &&
    isPaymentStatus(value.status) &&
    "provider" in value &&
    ["MOCK_TEST", "STRIPE"].includes(String(value.provider)) &&
    "simulated" in value &&
    typeof value.simulated === "boolean" &&
    "livemode" in value &&
    typeof value.livemode === "boolean" &&
    (!("externalPaymentId" in value) ||
      typeof value.externalPaymentId === "string") &&
    (!("paidAt" in value) || typeof value.paidAt === "string") &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}

export function parsePaymentRequest(value: unknown): PaymentRequestView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("payment" in value) ||
    !isPayment(value.payment) ||
    ("checkoutUrl" in value &&
      typeof value.checkoutUrl !== "string")
  ) {
    throw new Error("The server returned invalid Payment request data.");
  }
  const checkoutUrl =
    "checkoutUrl" in value ? value.checkoutUrl : undefined;
  if (
    typeof checkoutUrl === "string" &&
    !checkoutUrl.startsWith("https://checkout.stripe.com/")
  ) {
    throw new Error("The server returned an invalid Checkout URL.");
  }
  return value as PaymentRequestView;
}

export function parsePaymentResponse(value: unknown): PaymentView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("payment" in value) ||
    !isPayment(value.payment)
  ) {
    throw new Error("The server returned invalid Payment data.");
  }
  return value.payment;
}

export function parsePaymentList(value: unknown): PaymentView[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("payments" in value) ||
    !Array.isArray(value.payments) ||
    !value.payments.every(isPayment)
  ) {
    throw new Error("The server returned invalid Payment data.");
  }
  return value.payments;
}

export async function paymentApi(
  endpoint: string,
  method: "GET" | "POST",
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
        : "The Payment request could not be completed.",
    );
  }
  return result;
}
