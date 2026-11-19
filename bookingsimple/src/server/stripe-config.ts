import "server-only";

export type StripeMode = "test" | "live";

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  connectClientId: string;
  mode: StripeMode;
  appOrigin: string;
  oauthRedirectUri: string;
};

export function parseStripeConfig(
  environment: NodeJS.ProcessEnv,
): StripeConfig {
  const secretKey = environment.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret =
    environment.STRIPE_CONNECT_WEBHOOK_SECRET?.trim() ?? "";
  const connectClientId =
    environment.STRIPE_CONNECT_CLIENT_ID?.trim() ?? "";
  const mode = secretKey.startsWith("sk_live_")
    ? "live"
    : secretKey.startsWith("sk_test_")
      ? "test"
      : null;
  if (!mode) {
    throw new Error(
      "Stripe is not configured with a valid server-side secret key.",
    );
  }
  if (!/^whsec_[A-Za-z0-9_=-]{16,}$/.test(webhookSecret)) {
    throw new Error(
      "Stripe is not configured with a valid Connect webhook secret.",
    );
  }
  if (!/^ca_[A-Za-z0-9_]+$/.test(connectClientId)) {
    throw new Error(
      "Stripe is not configured with a valid Connect OAuth client ID.",
    );
  }
  const originValue = environment.APP_ORIGIN?.trim() ?? "";
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originValue);
  } catch {
    throw new Error("Stripe requires an exact application origin.");
  }
  if (
    !["http:", "https:"].includes(parsedOrigin.protocol) ||
    parsedOrigin.origin !== originValue.replace(/\/$/, "")
  ) {
    throw new Error("Stripe requires an exact HTTP or HTTPS application origin.");
  }
  const appOrigin = parsedOrigin.origin;
  if (
    mode === "live" &&
    parsedOrigin.protocol !== "https:"
  ) {
    throw new Error("Live Stripe mode requires an HTTPS application origin.");
  }
  return {
    secretKey,
    webhookSecret,
    connectClientId,
    mode,
    appOrigin,
    oauthRedirectUri: `${appOrigin}/api/stripe/connect/oauth/callback`,
  };
}

export function stripeIsConfigured(): boolean {
  try {
    parseStripeConfig(process.env);
    return true;
  } catch {
    return false;
  }
}
