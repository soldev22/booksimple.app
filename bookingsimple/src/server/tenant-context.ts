import "server-only";

import { AuthPolicyError } from "./auth-policy";
import { controlContainer, readDocument, type AuthDocument } from "./auth-storage";
import type { UserDocument } from "./auth";
import type { TenantContext, Viewer } from "./auth-types";

type BusinessDocument = AuthDocument & {
  type: "business";
  name: string;
  status: "pending" | "active" | "rejected" | "disabled";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export async function resolveTenantContext(
  user: UserDocument,
): Promise<TenantContext | null> {
  const membership = user.membership;
  if (!membership) {
    return null;
  }
  const business = await readDocument<BusinessDocument>(
    controlContainer(),
    membership.tenantId,
    membership.tenantId,
  );
  if (
    !business ||
    business.document.type !== "business" ||
    business.document.id !== membership.tenantId ||
    business.document.partitionKey !== membership.tenantId ||
    business.document.status !== "active" ||
    typeof business.document.name !== "string" ||
    business.document.name.length === 0
  ) {
    return null;
  }
  return {
    tenantId: membership.tenantId,
    businessName: business.document.name,
    username: membership.username,
    role: membership.role,
  };
}

export function requireTenantContext(viewer: Viewer | null): TenantContext {
  if (!viewer) {
    throw new AuthPolicyError("Sign in is required.", 401);
  }
  if (!viewer.tenant) {
    throw new AuthPolicyError("An active business membership is required.", 403);
  }
  return viewer.tenant;
}

export function requireCompanyAdmin(context: TenantContext): void {
  if (context.role !== "company_admin") {
    throw new AuthPolicyError("Company administrator access is required.", 403);
  }
}

export function assertTenantAccess(
  context: TenantContext,
  tenantId: string,
): void {
  if (tenantId !== context.tenantId) {
    throw new AuthPolicyError("Access to this business is not allowed.", 403);
  }
}
