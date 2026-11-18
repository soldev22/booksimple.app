import "server-only";

import type Stripe from "stripe";
import type {
  PaymentProviderAdapter,
  ProviderPaymentRequest,
} from "./payment-provider";
import { getStripeClient } from "./stripe-client";
import { getReadyStripeAccountForContext } from "./stripe-connect-service";
import { parseStripeConfig } from "./stripe-config";

function paymentLabel(paymentType: "DEPOSIT" | "BALANCE" | "FULL_PAYMENT") {
  if (paymentType === "DEPOSIT") return "Booking deposit";
  if (paymentType === "BALANCE") return "Booking balance";
  return "Booking payment";
}

async function retrieveOpenSession(
  sessionId: string,
  accountId: string,
  checkoutAttempt: number,
): Promise<ProviderPaymentRequest | null> {
  const session = await getStripeClient().checkout.sessions.retrieve(
    sessionId,
    {},
    { stripeAccount: accountId },
  );
  if (session.status === "expired") return null;
  return {
    externalPaymentId: session.id,
    checkoutUrl:
      session.status === "open" && session.url ? session.url : undefined,
    checkoutAttempt,
  };
}

export const stripePaymentProvider: PaymentProviderAdapter = {
  provider: "STRIPE",
  simulated: false,
  async createPaymentRequest(input) {
    const config = parseStripeConfig(process.env);
    const account = await getReadyStripeAccountForContext(input.context);
    if (input.existingExternalPaymentId) {
      try {
        const existing = await retrieveOpenSession(
          input.existingExternalPaymentId,
          account.accountId,
          input.checkoutAttempt,
        );
        if (existing) return existing;
      } catch {
        throw new Error("The existing Stripe Checkout Session is unavailable.");
      }
    }
    const checkoutAttempt = input.checkoutAttempt + 1;
    const metadata: Stripe.MetadataParam = {
      tenantId: input.context.tenantId,
      bookingId: input.bookingId,
      paymentId: input.paymentId,
      paymentType: input.paymentType,
    };
    const session = await getStripeClient().checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: input.paymentId,
        metadata,
        payment_intent_data: { metadata },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: `${paymentLabel(input.paymentType)} - ${input.serviceName}`.slice(
                  0,
                  120,
                ),
              },
            },
          },
        ],
        success_url: `${config.appOrigin}/bookings/${encodeURIComponent(input.bookingId)}?checkout=returned`,
        cancel_url: `${config.appOrigin}/bookings/${encodeURIComponent(input.bookingId)}?checkout=cancelled`,
      },
      {
        stripeAccount: account.accountId,
        idempotencyKey: `booksimple-checkout-${input.paymentId}-${checkoutAttempt}`,
      },
    );
    if (
      session.livemode !== (config.mode === "live") ||
      !session.url
    ) {
      throw new Error("Stripe returned an invalid Checkout Session.");
    }
    return {
      externalPaymentId: session.id,
      checkoutUrl: session.url,
      checkoutAttempt,
    };
  },
};
