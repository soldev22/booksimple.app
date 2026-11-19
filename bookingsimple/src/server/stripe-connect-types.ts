import type { StripeMode } from "./stripe-config";

export type StripeConnectionStatus =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "ONBOARDING_REQUIRED"
  | "RESTRICTED"
  | "READY";

export type StripeConnectionView = {
  mode?: StripeMode;
  status: StripeConnectionStatus;
  canManage: boolean;
  accountReference?: string;
  details?: string;
};

export type StripeOnboardingView = {
  url: string;
  mode: StripeMode;
};

export type StripeOAuthCompletion = {
  outcome: "CONNECTED" | "CANCELLED";
};
