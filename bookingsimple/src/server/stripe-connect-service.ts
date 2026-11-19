import "server-only";

import { getRequestViewer } from "./auth";
import { randomToken, sha256 } from "./auth-crypto";
import {
  controlContainer,
  createDocument,
  isPreconditionFailed,
  readDocument,
  replaceDocument,
  StorageError,
  type AuthDocument,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import {
  DEFAULT_BUSINESS_COUNTRY,
  DEFAULT_BUSINESS_CURRENCY,
  type BusinessDocument,
  type StripeConnectedAccountReference,
} from "./business-types";
import { getStripeClient } from "./stripe-client";
import {
  parseStripeConfig,
  stripeIsConfigured,
  type StripeMode,
} from "./stripe-config";
import type {
  StripeConnectionView,
  StripeOAuthCompletion,
  StripeOnboardingView,
} from "./stripe-connect-types";
import {
  buildStripeOAuthAuthorizeUrl,
  parseStripeOAuthCallback,
  stripeModeMatches,
} from "./stripe-oauth";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

const OAUTH_STATE_SECONDS = 10 * 60;
const CONSUMED_STATE_SECONDS = 24 * 60 * 60;

type StripeOAuthStateDocument = AuthDocument & {
  type: "stripe-oauth-state";
  tenantId: string;
  requestedByUserId: string;
  mode: StripeMode;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "FAILED";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

function stripeError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function stripeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function stateId(state: string): string {
  return `stripe-oauth-state-${sha256(state)}`;
}

async function readBusiness(tenantId: string) {
  const business = await readDocument<BusinessDocument>(
    controlContainer(),
    tenantId,
    tenantId,
  );
  if (
    !business ||
    business.document.type !== "business" ||
    business.document.status !== "active"
  ) {
    throw stripeError(404, "The active Business was not found.");
  }
  return business;
}

function referenceForMode(
  business: BusinessDocument,
  mode: StripeMode,
): StripeConnectedAccountReference | undefined {
  return business.stripeConnect?.[mode];
}

function accountReference(accountId: string): string {
  return `...${accountId.slice(-8)}`;
}

async function connectionView(
  context: TenantContext,
  canManage: boolean,
): Promise<StripeConnectionView> {
  if (!stripeIsConfigured()) {
    return {
      status: "NOT_CONFIGURED",
      canManage,
      details: "Stripe platform environment variables are not configured.",
    };
  }
  const config = parseStripeConfig(process.env);
  const business = await readBusiness(context.tenantId);
  const reference = referenceForMode(business.document, config.mode);
  if (!reference) {
    return {
      mode: config.mode,
      status: "NOT_CONNECTED",
      canManage,
    };
  }
  let account;
  try {
    account = await getStripeClient().accounts.retrieve(reference.accountId);
  } catch {
    throw stripeError(
      503,
      "Stripe connection status could not be retrieved.",
    );
  }
  if ("deleted" in account && account.deleted) {
    throw stripeError(409, "The connected Stripe account is no longer available.");
  }
  const status = account.charges_enabled
    ? "READY"
    : account.requirements?.disabled_reason
      ? "RESTRICTED"
      : "ONBOARDING_REQUIRED";
  return {
    mode: config.mode,
    status,
    canManage,
    accountReference: accountReference(account.id),
  };
}

export async function getStripeConnection(
  request: Request,
): Promise<StripeConnectionView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  return connectionView(context, context.role === "company_admin");
}

export async function getReadyStripeAccountForContext(
  context: TenantContext,
): Promise<{ accountId: string; mode: StripeMode }> {
  const view = await connectionView(context, false);
  if (view.status !== "READY" || !view.mode) {
    throw stripeError(
      409,
      "This Business must connect a payment-ready Stripe account before accepting payments.",
    );
  }
  const business = await readBusiness(context.tenantId);
  const reference = referenceForMode(business.document, view.mode);
  if (!reference) {
    throw stripeError(409, "The Stripe connected account is not available.");
  }
  return { accountId: reference.accountId, mode: view.mode };
}

async function persistAccountReference(
  tenantId: string,
  mode: StripeMode,
  reference: StripeConnectedAccountReference,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const business = await readBusiness(tenantId);
    const existing = referenceForMode(business.document, mode);
    if (existing) {
      if (existing.accountId !== reference.accountId) {
        throw stripeError(
          409,
          "This Business already has a different Stripe account for this mode.",
        );
      }
      return;
    }
    try {
      await replaceDocument(
        controlContainer(),
        {
          ...business.document,
          stripeConnect: {
            ...business.document.stripeConnect,
            [mode]: reference,
          },
          updatedAt: new Date().toISOString(),
        },
        business.etag,
      );
      return;
    } catch (error) {
      if (isPreconditionFailed(error)) continue;
      throw error;
    }
  }
  throw stripeError(
    409,
    "Business settings changed while connecting Stripe. Retry.",
  );
}

async function createOAuthState(
  tenantId: string,
  userId: string,
  mode: StripeMode,
): Promise<string> {
  const state = randomToken();
  const id = stateId(state);
  const now = new Date();
  await createDocument<StripeOAuthStateDocument>(controlContainer(), {
    id,
    partitionKey: id,
    type: "stripe-oauth-state",
    schemaVersion: 1,
    tenantId,
    requestedByUserId: userId,
    mode,
    status: "PENDING",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OAUTH_STATE_SECONDS * 1000).toISOString(),
    ttl: OAUTH_STATE_SECONDS,
  });
  return state;
}

async function consumeOAuthState(
  state: string,
  expectedMode: StripeMode,
): Promise<StripeOAuthStateDocument> {
  const id = stateId(state);
  const current = await readDocument<StripeOAuthStateDocument>(
    controlContainer(),
    id,
    id,
  );
  if (
    !current ||
    current.document.type !== "stripe-oauth-state" ||
    current.document.status !== "PENDING" ||
    current.document.mode !== expectedMode ||
    Date.parse(current.document.expiresAt) <= Date.now()
  ) {
    throw stripeError(400, "Stripe connection state is invalid or expired.");
  }
  try {
    const next: StripeOAuthStateDocument = {
      ...current.document,
      status: "PROCESSING",
      ttl: CONSUMED_STATE_SECONDS,
    };
    const processing = await replaceDocument(
      controlContainer(),
      next,
      current.etag,
    );
    return processing.document;
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw stripeError(409, "Stripe connection state was already used.");
    }
    throw error;
  }
}

async function finishOAuthState(
  document: StripeOAuthStateDocument,
  status: "COMPLETED" | "CANCELLED" | "FAILED",
): Promise<void> {
  const current = await readDocument<StripeOAuthStateDocument>(
    controlContainer(),
    document.id,
    document.partitionKey,
  );
  if (!current || current.document.status !== "PROCESSING") return;
  await replaceDocument(
    controlContainer(),
    {
      ...current.document,
      status,
      completedAt: new Date().toISOString(),
      ttl: CONSUMED_STATE_SECONDS,
    },
    current.etag,
  );
}

export async function createStripeOnboardingLink(
  request: Request,
): Promise<StripeOnboardingView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  if (!viewer) throw stripeError(401, "Sign in is required.");
  const config = parseStripeConfig(process.env);
  const business = await readBusiness(context.tenantId);
  const existing = referenceForMode(business.document, config.mode);
  if (existing) {
    throw stripeError(
      409,
      "This Business already has a connected Stripe account for this mode.",
    );
  }
  const state = await createOAuthState(
    context.tenantId,
    viewer.user.id,
    config.mode,
  );
  return {
    url: buildStripeOAuthAuthorizeUrl({
      clientId: config.connectClientId,
      redirectUri: config.oauthRedirectUri,
      state,
      email: viewer.user.email,
      businessName: business.document.name,
      country: business.document.country ?? DEFAULT_BUSINESS_COUNTRY,
      currency: business.document.currency ?? DEFAULT_BUSINESS_CURRENCY,
    }),
    mode: config.mode,
  };
}

export async function completeStripeOAuthConnection(
  requestUrl: string,
): Promise<StripeOAuthCompletion> {
  const callback = parseStripeOAuthCallback(new URL(requestUrl));
  const config = parseStripeConfig(process.env);
  const state = await consumeOAuthState(callback.state, config.mode);
  if (callback.outcome === "DENIED") {
    await finishOAuthState(state, "CANCELLED");
    return { outcome: "CANCELLED" };
  }

  let connectedAccountId: string | undefined;
  try {
    const token = await getStripeClient().oauth.token({
      grant_type: "authorization_code",
      code: callback.code,
    });
    if (
      token.scope !== "read_write" ||
      !stripeModeMatches(config.mode, token.livemode) ||
      !token.stripe_user_id ||
      !/^acct_[A-Za-z0-9]+$/.test(token.stripe_user_id)
    ) {
      throw new Error("Stripe OAuth returned an invalid account.");
    }
    connectedAccountId = token.stripe_user_id;
    const account = await getStripeClient().accounts.retrieve(connectedAccountId);
    if ("deleted" in account && account.deleted) {
      throw new Error("Stripe OAuth returned a deleted account.");
    }
    await persistAccountReference(state.tenantId, config.mode, {
      accountId: connectedAccountId,
      connectionMethod: "OAUTH",
      createdAt: new Date().toISOString(),
    });
    await finishOAuthState(state, "COMPLETED");
    return { outcome: "CONNECTED" };
  } catch (error) {
    if (connectedAccountId) {
      try {
        await getStripeClient().oauth.deauthorize({
          client_id: config.connectClientId,
          stripe_user_id: connectedAccountId,
        });
      } catch {
        console.error(
          JSON.stringify({
            event: "stripe-oauth-rollback-failed",
            code: stripeErrorCode(error),
          }),
        );
      }
    }
    await finishOAuthState(state, "FAILED");
    console.error(
      JSON.stringify({
        event: "stripe-oauth-completion-failed",
        code: stripeErrorCode(error),
      }),
    );
    throw stripeError(
      503,
      "Stripe account connection could not be completed. Retry from Business profile.",
    );
  }
}
