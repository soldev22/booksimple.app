import "server-only";

import { randomBytes } from "node:crypto";
import {
  getRequestViewer,
  resolveRequestSession,
} from "./auth";
import { secureEqual, sha256 } from "./auth-crypto";
import {
  invitationEmail,
  deliverNotification,
  makeNotification,
} from "./auth-notifications";
import { acceptCompanyUserMembership } from "./auth-service";
import {
  controlContainer,
  createDocument,
  isConflict,
  isPreconditionFailed,
  queryAllPages,
  readDocument,
  replaceDocument,
  StorageError,
} from "./auth-storage";
import {
  DEFAULT_BUSINESS_CURRENCY,
  DEFAULT_BUSINESS_TIMEZONE,
  type BusinessDocument,
  type BusinessInvitationDocument,
  type BusinessInvitationView,
  type BusinessSetupView,
  type BusinessSettingsView,
} from "./business-types";
import type {
  BusinessUpdateInput,
  CreateInvitationInput,
} from "./business-validation";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

const INVITATION_SECONDS = 7 * 24 * 60 * 60;
const INVITATION_RETENTION_SECONDS = 365 * 24 * 60 * 60;

function businessError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

async function readActiveBusiness(
  tenantId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof readDocument<BusinessDocument>>>>> {
  const business = await readDocument<BusinessDocument>(
    controlContainer(),
    tenantId,
    tenantId,
  );
  if (
    !business ||
    business.document.type !== "business" ||
    business.document.id !== tenantId ||
    business.document.partitionKey !== tenantId ||
    business.document.status !== "active"
  ) {
    throw businessError(404, "The active business was not found.");
  }
  return business;
}

function toBusinessSettings(
  document: BusinessDocument,
  canManage: boolean,
): BusinessSettingsView {
  return {
    id: document.id,
    name: document.name,
    status: document.status,
    timezone: document.timezone ?? DEFAULT_BUSINESS_TIMEZONE,
    currency: document.currency ?? DEFAULT_BUSINESS_CURRENCY,
    canManage,
  };
}

function toInvitationView(
  document: BusinessInvitationDocument,
): BusinessInvitationView {
  return {
    email: document.email,
    role: document.role,
    status: document.status,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
  };
}

export async function getBusinessSetup(
  request: Request,
): Promise<BusinessSetupView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  const canManage = context.role === "company_admin";
  const business = await readActiveBusiness(context.tenantId);
  const invitations = canManage
    ? await queryAllPages<BusinessInvitationDocument>(
        controlContainer(),
        "SELECT * FROM c WHERE c.partitionKey = @tenantId AND c.type = @type",
        [
          { name: "@tenantId", value: context.tenantId },
          { name: "@type", value: "business-invitation" },
        ],
        50,
        200,
      )
    : [];
  return {
    business: toBusinessSettings(business.document, canManage),
    invitations: invitations
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toInvitationView),
  };
}

export async function updateBusinessSettings(
  request: Request,
  input: BusinessUpdateInput,
): Promise<BusinessSettingsView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  const business = await readActiveBusiness(context.tenantId);
  try {
    const updated = await replaceDocument(
      controlContainer(),
      {
        ...business.document,
        name: input.name,
        timezone: input.timezone,
        currency: input.currency,
        updatedAt: new Date().toISOString(),
      },
      business.etag,
    );
    return toBusinessSettings(updated.document, true);
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw businessError(
        409,
        "The business settings changed. Refresh and retry.",
      );
    }
    throw error;
  }
}

export async function createBusinessInvitation(
  request: Request,
  input: CreateInvitationInput,
): Promise<void> {
  const viewer = await getRequestViewer(request);
  if (!viewer) {
    throw businessError(401, "Sign in is required.");
  }
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  if (viewer?.user.email === input.email) {
    throw businessError(409, "This account already belongs to the business.");
  }
  const business = await readActiveBusiness(context.tenantId);
  const id = `invitation_${sha256(input.email)}`;
  const existing = await readDocument<BusinessInvitationDocument>(
    controlContainer(),
    id,
    context.tenantId,
  );
  if (existing?.document.status === "accepted") {
    throw businessError(409, "This invitation has already been accepted.");
  }
  const now = new Date();
  const secret = randomBytes(32).toString("base64url");
  const token = `${context.tenantId}.${id}.${secret}`;
  const invitation: BusinessInvitationDocument = {
    id,
    partitionKey: context.tenantId,
    type: "business-invitation",
    schemaVersion: 1,
    email: input.email,
    role: "company_user",
    status: "pending",
    tokenHash: sha256(token),
    invitedByUserId: viewer.user.id,
    createdAt: existing?.document.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + INVITATION_SECONDS * 1000,
    ).toISOString(),
    ttl: INVITATION_RETENTION_SECONDS,
  };
  try {
    if (existing) {
      await replaceDocument(controlContainer(), invitation, existing.etag);
    } else {
      await createDocument(controlContainer(), invitation);
    }
  } catch (error) {
    if (isConflict(error) || isPreconditionFailed(error)) {
      throw businessError(
        409,
        "The invitation changed. Refresh and retry.",
      );
    }
    throw error;
  }
  const notification = makeNotification(
    context.tenantId,
    viewer.user.id,
    "business-invitation",
    invitationEmail(input.email, business.document.name, token),
  );
  await createDocument(controlContainer(), notification);
  if (!(await deliverNotification(context.tenantId, notification.id))) {
    throw businessError(
      503,
      "The invitation email could not be sent. Please try again later.",
    );
  }
}

function parseInvitationToken(token: string): {
  tenantId: string;
  invitationId: string;
} | null {
  const [tenantId, invitationId, secret, ...extra] = token.split(".");
  if (
    extra.length > 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tenantId,
    ) ||
    !/^invitation_[0-9a-f]{64}$/.test(invitationId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  ) {
    return null;
  }
  return { tenantId, invitationId };
}

export async function acceptBusinessInvitation(
  request: Request,
  token: string,
): Promise<void> {
  const authenticated = await resolveRequestSession(request);
  if (!authenticated) {
    throw businessError(401, "Sign in is required.");
  }
  const parsed = parseInvitationToken(token);
  if (!parsed) {
    throw businessError(400, "The invitation link is invalid.");
  }
  const invitation = await readDocument<BusinessInvitationDocument>(
    controlContainer(),
    parsed.invitationId,
    parsed.tenantId,
  );
  if (
    !invitation ||
    invitation.document.type !== "business-invitation" ||
    invitation.document.status !== "pending" ||
    Date.parse(invitation.document.expiresAt) <= Date.now() ||
    !secureEqual(invitation.document.tokenHash, sha256(token))
  ) {
    throw businessError(400, "The invitation link is invalid or has expired.");
  }
  if (authenticated.user.document.email !== invitation.document.email) {
    throw businessError(
      403,
      "Sign in with the email address that received this invitation.",
    );
  }
  await acceptCompanyUserMembership(authenticated.user, parsed.tenantId);
  const latest = await readDocument<BusinessInvitationDocument>(
    controlContainer(),
    parsed.invitationId,
    parsed.tenantId,
  );
  if (!latest) {
    throw businessError(503, "The invitation could not be completed.");
  }
  if (
    latest.document.status === "accepted" &&
    latest.document.acceptedByUserId === authenticated.user.document.userId
  ) {
    return;
  }
  if (
    latest.document.status !== "pending" ||
    !secureEqual(latest.document.tokenHash, sha256(token))
  ) {
    throw businessError(409, "The invitation changed. Refresh and retry.");
  }
  try {
    await replaceDocument(
      controlContainer(),
      {
        ...latest.document,
        status: "accepted",
        acceptedByUserId: authenticated.user.document.userId,
        tokenHash: sha256(randomBytes(32).toString("base64url")),
        updatedAt: new Date().toISOString(),
      },
      latest.etag,
    );
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw businessError(409, "The invitation changed. Refresh and retry.");
    }
    throw error;
  }
}
