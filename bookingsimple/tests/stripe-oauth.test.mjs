import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeOAuthAuthorizeUrl,
  parseStripeOAuthCallback,
  stripeModeMatches,
} from "../src/server/stripe-oauth.ts";

const state = "a".repeat(43);

test("Stripe OAuth authorization targets existing-account login safely", () => {
  const result = new URL(
    buildStripeOAuthAuthorizeUrl({
      clientId: "ca_test_example",
      redirectUri:
        "http://localhost:3000/api/stripe/connect/oauth/callback",
      state,
      email: "owner@example.com",
      businessName: "Example Business",
      country: "GB",
      currency: "GBP",
    }),
  );
  assert.equal(result.origin, "https://connect.stripe.com");
  assert.equal(result.pathname, "/oauth/authorize");
  assert.equal(result.searchParams.get("scope"), "read_write");
  assert.equal(result.searchParams.get("stripe_landing"), "login");
  assert.equal(result.searchParams.get("state"), state);
  assert.equal(result.searchParams.get("stripe_user[country]"), "GB");
  assert.equal(result.searchParams.get("stripe_user[currency]"), "gbp");
});

test("Stripe OAuth callback requires bounded state, code and scope", () => {
  assert.deepEqual(
    parseStripeOAuthCallback(
      new URL(
        `http://localhost/callback?state=${state}&code=ac_12345678&scope=read_write`,
      ),
    ),
    { outcome: "AUTHORIZED", state, code: "ac_12345678" },
  );
  assert.deepEqual(
    parseStripeOAuthCallback(
      new URL(
        `http://localhost/callback?state=${state}&error=access_denied`,
      ),
    ),
    { outcome: "DENIED", state },
  );
  assert.throws(() =>
    parseStripeOAuthCallback(
      new URL(
        `http://localhost/callback?state=${state}&code=ac_12345678&scope=read_only`,
      ),
    ),
  );
  assert.throws(() =>
    parseStripeOAuthCallback(
      new URL("http://localhost/callback?state=invalid&error=access_denied"),
    ),
  );
});

test("Stripe OAuth mode must match the configured key mode", () => {
  assert.equal(stripeModeMatches("test", false), true);
  assert.equal(stripeModeMatches("live", true), true);
  assert.equal(stripeModeMatches("test", true), false);
  assert.equal(stripeModeMatches("live", undefined), false);
});
