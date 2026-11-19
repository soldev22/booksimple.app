import type { StripeMode } from "./stripe-config";

export const STRIPE_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STRIPE_OAUTH_CODE_PATTERN = /^ac_[A-Za-z0-9_]{8,197}$/;

export type StripeOAuthAuthorizeInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  email: string;
  businessName: string;
  country: string;
  currency: string;
};

export type StripeOAuthCallback =
  | { outcome: "AUTHORIZED"; state: string; code: string }
  | { outcome: "DENIED"; state: string };

export function buildStripeOAuthAuthorizeUrl(
  input: StripeOAuthAuthorizeInput,
): string {
  if (!STRIPE_OAUTH_STATE_PATTERN.test(input.state)) {
    throw new Error("Stripe OAuth state is invalid.");
  }
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("stripe_landing", "login");
  url.searchParams.set("stripe_user[email]", input.email);
  url.searchParams.set("stripe_user[business_name]", input.businessName);
  url.searchParams.set("stripe_user[country]", input.country);
  url.searchParams.set("stripe_user[currency]", input.currency.toLowerCase());
  return url.toString();
}

export function parseStripeOAuthCallback(url: URL): StripeOAuthCallback {
  const state = url.searchParams.get("state") ?? "";
  if (!STRIPE_OAUTH_STATE_PATTERN.test(state)) {
    throw new Error("Stripe OAuth state is invalid.");
  }
  const error = url.searchParams.get("error");
  if (error) {
    if (error !== "access_denied") {
      throw new Error("Stripe OAuth returned an invalid response.");
    }
    return { outcome: "DENIED", state };
  }
  const code = url.searchParams.get("code") ?? "";
  const scope = url.searchParams.get("scope");
  if (!STRIPE_OAUTH_CODE_PATTERN.test(code) || scope !== "read_write") {
    throw new Error("Stripe OAuth returned an invalid response.");
  }
  return { outcome: "AUTHORIZED", state, code };
}

export function stripeModeMatches(
  mode: StripeMode,
  livemode: boolean | undefined,
): boolean {
  return livemode === (mode === "live");
}
