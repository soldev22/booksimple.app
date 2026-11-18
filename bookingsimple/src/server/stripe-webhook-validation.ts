import type Stripe from "stripe";
import type {
  PaymentDocument,
  PaymentStatus,
} from "./payment-types";
import type { StripeMode } from "./stripe-config";

export function stripeEventOutcome(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): "PAID" | "FAILED" | null {
  if (
    (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded") &&
    session.payment_status === "paid"
  ) {
    return "PAID";
  }
  if (event.type === "checkout.session.async_payment_failed") return "FAILED";
  return null;
}

export function validateStripeCheckoutEvent(
  payment: PaymentDocument,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  configuredMode: StripeMode,
): void {
  if (
    payment.provider !== "STRIPE" ||
    event.account !== payment.connectedAccountId ||
    event.livemode !== payment.livemode ||
    event.livemode !== (configuredMode === "live") ||
    session.id !== payment.externalPaymentId ||
    session.client_reference_id !== payment.id ||
    session.metadata?.tenantId !== payment.tenantId ||
    session.metadata?.bookingId !== payment.bookingId ||
    session.metadata?.paymentId !== payment.id ||
    session.metadata?.paymentType !== payment.paymentType ||
    session.amount_total !== payment.amountMinor ||
    session.currency?.toUpperCase() !== payment.currency
  ) {
    throw new Error("The Stripe event does not match the Payment.");
  }
}

export function resolveStripePaymentStatus(
  current: PaymentStatus,
  outcome: "PAID" | "FAILED",
): PaymentStatus {
  return current === "PAID" ? "PAID" : outcome;
}
