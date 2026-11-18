import "server-only";

import Stripe from "stripe";
import { parseStripeConfig } from "./stripe-config";

let cached:
  | {
      key: string;
      client: Stripe;
    }
  | undefined;

export function getStripeClient(): Stripe {
  const config = parseStripeConfig(process.env);
  if (cached?.key === config.secretKey) return cached.client;
  const client = new Stripe(config.secretKey, {
    apiVersion: "2026-10-28.endive",
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
  cached = { key: config.secretKey, client };
  return client;
}
