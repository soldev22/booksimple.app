import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { parseStripeConfig } from "../src/server/stripe-config.ts";
import { processStripeWebhook } from "../src/server/payment-service.ts";
import {
  resolveStripePaymentStatus,
  validateStripeCheckoutEvent,
} from "../src/server/stripe-webhook-validation.ts";

test("Stripe configuration derives mode and enforces live HTTPS", () => {
  assert.deepEqual(
    parseStripeConfig({
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_1234567890123456",
      STRIPE_CONNECT_CLIENT_ID: "ca_test_example",
      APP_ORIGIN: "http://localhost:3000",
    }),
    {
      secretKey: "sk_test_example",
      webhookSecret: "whsec_1234567890123456",
      connectClientId: "ca_test_example",
      mode: "test",
      appOrigin: "http://localhost:3000",
      oauthRedirectUri:
        "http://localhost:3000/api/stripe/connect/oauth/callback",
    },
  );
  assert.throws(() =>
    parseStripeConfig({
      STRIPE_SECRET_KEY: "sk_live_example",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_1234567890123456",
      STRIPE_CONNECT_CLIENT_ID: "ca_live_example",
      APP_ORIGIN: "http://localhost:3000",
    }),
  );
  assert.throws(() =>
    parseStripeConfig({
      STRIPE_SECRET_KEY: "not-a-secret-key",
      STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_1234567890123456",
      STRIPE_CONNECT_CLIENT_ID: "ca_live_example",
      APP_ORIGIN: "https://example.com",
    }),
  );
});

test("Stripe webhook verification rejects tampering and accepts signed ignored events", async () => {
  const previous = {
    APP_ORIGIN: process.env.APP_ORIGIN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_CONNECT_WEBHOOK_SECRET:
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    STRIPE_CONNECT_CLIENT_ID: process.env.STRIPE_CONNECT_CLIENT_ID,
  };
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET =
    "whsec_1234567890123456";
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test_example";
  try {
    const payload = JSON.stringify({
      id: "evt_test_signed",
      object: "event",
      api_version: "2026-10-28.endive",
      created: 1_700_000_000,
      data: { object: { id: "acct_example", object: "account" } },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "account.updated",
    });

    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    });
    await processStripeWebhook(payload, signature);
    await assert.rejects(
      processStripeWebhook(`${payload} `, signature),
      /signature is invalid/,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Stripe Checkout events must match account, mode and snapshotted terms", () => {
  const payment = {
    id: "deposit-11111111-1111-4111-8111-111111111111",
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    type: "payment",
    schemaVersion: 1,
    bookingId: "11111111-1111-4111-8111-111111111111",
    paymentType: "DEPOSIT",
    amountMinor: 2500,
    currency: "GBP",
    status: "PENDING",
    provider: "STRIPE",
    simulated: false,
    livemode: false,
    connectedAccountId: "acct_tenant_a",
    externalPaymentId: "cs_test_session",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
  };
  const event = {
    account: "acct_tenant_a",
    livemode: false,
  };
  const session = {
    id: "cs_test_session",
    client_reference_id: payment.id,
    amount_total: 2500,
    currency: "gbp",
    metadata: {
      tenantId: payment.tenantId,
      bookingId: payment.bookingId,
      paymentId: payment.id,
      paymentType: payment.paymentType,
    },
  };
  assert.doesNotThrow(() =>
    validateStripeCheckoutEvent(payment, event, session, "test"),
  );
  assert.throws(() =>
    validateStripeCheckoutEvent(
      payment,
      { ...event, account: "acct_tenant_b" },
      session,
      "test",
    ),
  );
  assert.throws(() =>
    validateStripeCheckoutEvent(
      payment,
      { ...event, livemode: true },
      session,
      "live",
    ),
  );
  assert.throws(() =>
    validateStripeCheckoutEvent(
      payment,
      event,
      { ...session, amount_total: 2499 },
      "test",
    ),
  );
  assert.equal(resolveStripePaymentStatus("PENDING", "FAILED"), "FAILED");
  assert.equal(resolveStripePaymentStatus("FAILED", "PAID"), "PAID");
  assert.equal(resolveStripePaymentStatus("PAID", "FAILED"), "PAID");
});
