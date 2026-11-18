import "server-only";

import { getRequestViewer } from "./auth";
import {
  controlContainer,
  isPreconditionFailed,
  replaceDocument,
  StorageError,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import type {
  BusinessDocument,
  StripeConnectedAccountReference,
} from "./business-types";
import { readDocument } from "./auth-storage";
import { getStripeClient } from "./stripe-client";
import {
  parseStripeConfig,
  stripeIsConfigured,
  type StripeMode,
} from "./stripe-config";
import type {
  StripeConnectionView,
  StripeOnboardingView,
} from "./stripe-connect-types";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

function stripeError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function stripeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function readBusiness(context: TenantContext) {
  const business = await readDocument<BusinessDocument>(
    controlContainer(),
    context.tenantId,
    context.tenantId,
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
  const business = await readBusiness(context);
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
    account = await getStripeClient().v2.core.accounts.retrieve(
      reference.accountId,
      {
        include: [
          "configuration.merchant",
          "defaults",
          "requirements",
        ],
      },
    );
  } catch (error) {
    if (
      stripeErrorCode(error) ===
      "non_connect_platform_accounts_v2_access_blocked"
    ) {
      throw stripeError(
        409,
        "Complete Stripe Connect platform setup in the Stripe Dashboard, then retry.",
      );
    }
    throw stripeError(
      503,
      "Stripe connection status could not be retrieved.",
    );
  }
  if (
    account.livemode !== (config.mode === "live") ||
    account.metadata?.tenantId !== context.tenantId
  ) {
    throw stripeError(
      503,
      "The Stripe connected account does not match this Business and mode.",
    );
  }
  const capability =
    account.configuration?.merchant?.capabilities?.card_payments?.status;
  const status =
    capability === "active"
      ? "READY"
      : capability === "rejected" ||
          capability === "restricted" ||
          capability === "unsupported"
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
      "This Business must complete Stripe onboarding before accepting payments.",
    );
  }
  const business = await readBusiness(context);
  const reference = referenceForMode(business.document, view.mode);
  if (!reference) {
    throw stripeError(409, "The Stripe connected account is not available.");
  }
  return { accountId: reference.accountId, mode: view.mode };
}

async function persistAccountReference(
  context: TenantContext,
  mode: StripeMode,
  reference: StripeConnectedAccountReference,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const business = await readBusiness(context);
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

export async function createStripeOnboardingLink(
  request: Request,
): Promise<StripeOnboardingView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  if (!viewer) throw stripeError(401, "Sign in is required.");
  const config = parseStripeConfig(process.env);
  const business = await readBusiness(context);
  let reference = referenceForMode(business.document, config.mode);
  if (!reference) {
    let account;
    try {
      account = await getStripeClient().v2.core.accounts.create(
        {
          contact_email: viewer.user.email,
          display_name: business.document.name,
          dashboard: "full",
          configuration: {
            merchant: {
              capabilities: {
                card_payments: { requested: true },
              },
            },
          },
          defaults: {
            currency: (
              business.document.currency ?? "GBP"
            ).toLowerCase(),
            responsibilities: {
              fees_collector: "stripe",
              losses_collector: "stripe",
            },
          },
          metadata: { tenantId: context.tenantId },
          include: [
            "configuration.merchant",
            "defaults",
            "requirements",
          ],
        },
        {
          idempotencyKey: `booksimple-connect-${context.tenantId}-${config.mode}`,
        },
      );
    } catch {
      throw stripeError(
        503,
        "Stripe could not create the connected account. Check the platform Connect configuration.",
      );
    }
    if (account.livemode !== (config.mode === "live")) {
      throw stripeError(503, "Stripe created the account in the wrong mode.");
    }
    reference = {
      accountId: account.id,
      createdAt: new Date().toISOString(),
    };
    await persistAccountReference(context, config.mode, reference);
  }
  try {
    const link = await getStripeClient().v2.core.accountLinks.create({
      account: reference.accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          collection_options: {
            fields: "eventually_due",
            future_requirements: "include",
          },
          refresh_url: `${config.appOrigin}/account?stripe=refresh`,
          return_url: `${config.appOrigin}/account?stripe=returned`,
        },
      },
    });
    if (link.livemode !== (config.mode === "live")) {
      throw new Error("Stripe returned an onboarding link in the wrong mode.");
    }
    return { url: link.url, mode: config.mode };
  } catch {
    throw stripeError(
      503,
      "Stripe onboarding could not be started. Retry from Business profile.",
    );
  }
}
