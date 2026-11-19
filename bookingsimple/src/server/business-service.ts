import "server-only";

import { randomBytes } from "node:crypto";
import {
  getRequestViewer,
  type UserDocument,
} from "./auth";
import { sha256 } from "./auth-crypto";
import {
  invitationEmail,
  deliverNotification,
  makeNotification,
} from "./auth-notifications";
import {
  commitBatch,
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
  DEFAULT_BUSINESS_COUNTRY,
  DEFAULT_BUSINESS_CURRENCY,
  DEFAULT_BUSINESS_TIMEZONE,
  DEFAULT_DEPOSIT_PERCENTAGE,
  type BusinessDocument,
  type BusinessInvitationDocument,
  type BusinessInvitationView,
  type BusinessSetupView,
  type BusinessSettingsView,
} from "./business-types";
import type {
  BusinessUpdateInput,
  CreateInvitationInput,
  DeleteInvitationInput,
} from "./business-validation";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";
import { DATA_RETENTION } from "./data-retention";

const INVITATION_SECONDS = 7 * 24 * 60 * 60;

function businessError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

async function acceptedInvitationAccountWasDeleted(
  invitation: BusinessInvitationDocument,
): Promise<boolean> {
  if (!invitation.acceptedByUserId) return false;
  const iterator = controlContainer().items.query<{
    status: UserDocument["status"];
  }>(
    {
      query:
        "SELECT TOP 2 c.status FROM c WHERE c.type = @type AND c.userId = @userId",
      parameters: [
        { name: "@type", value: "user" },
        { name: "@userId", value: invitation.acceptedByUserId },
      ],
    },
    { maxItemCount: 2 },
  );
  const result = await iterator.fetchNext();
  if (result.resources.length > 1) {
    throw businessError(503, "The accepted account record is not unique.");
  }
  return result.resources[0]?.status === "deleted";
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
    country: document.country ?? DEFAULT_BUSINESS_COUNTRY,
    currency: document.currency ?? DEFAULT_BUSINESS_CURRENCY,
    defaultDepositPercentage:
      document.defaultDepositPercentage ?? DEFAULT_DEPOSIT_PERCENTAGE,
    reminderRules: document.reminderRules ?? [],
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
        "SELECT * FROM c WHERE c.partitionKey = @tenantId AND c.type = @type AND c.status = @status",
        [
          { name: "@tenantId", value: context.tenantId },
          { name: "@type", value: "business-invitation" },
          { name: "@status", value: "pending" },
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
        country: input.country,
        currency: input.currency,
        defaultDepositPercentage: input.defaultDepositPercentage,
        reminderRules: input.reminderRules,
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
  if (
    existing?.document.status === "accepted" &&
    !(await acceptedInvitationAccountWasDeleted(existing.document))
  ) {
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
    createdAt:
      existing?.document.status === "pending"
        ? existing.document.createdAt
        : now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + INVITATION_SECONDS * 1000,
    ).toISOString(),
    ttl: DATA_RETENTION.invitationPendingSeconds,
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
    invitation.id,
  );
  await createDocument(controlContainer(), notification);
  if (!(await deliverNotification(context.tenantId, notification.id))) {
    throw businessError(
      503,
      "The invitation email could not be sent. Please try again later.",
    );
  }
}

export async function deleteBusinessInvitation(
  request: Request,
  input: DeleteInvitationInput,
): Promise<void> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  const id = `invitation_${sha256(input.email)}`;
  const invitation = await readDocument<BusinessInvitationDocument>(
    controlContainer(),
    id,
    context.tenantId,
  );
  if (
    !invitation ||
    invitation.document.type !== "business-invitation" ||
    invitation.document.email !== input.email
  ) {
    throw businessError(404, "The pending invitation was not found.");
  }
  if (invitation.document.status !== "pending") {
    throw businessError(409, "Only pending invitations can be deleted.");
  }
  const retryableNotifications = await queryAllPages<{ id: string }>(
    controlContainer(),
    "SELECT c.id FROM c WHERE c.partitionKey = @tenantId AND c.type = @type AND c.event = @event AND c.relatedId = @relatedId AND c.status != @sent",
    [
      { name: "@tenantId", value: context.tenantId },
      { name: "@type", value: "notification" },
      { name: "@event", value: "business-invitation" },
      { name: "@relatedId", value: invitation.document.id },
      { name: "@sent", value: "sent" },
    ],
    50,
    90,
  );
  await commitBatch(controlContainer(), context.tenantId, [
    ...retryableNotifications.map(
      (notification): import("@azure/cosmos").OperationInput => ({
        operationType: "Delete",
        id: notification.id,
      }),
    ),
    {
      operationType: "Delete",
      id: invitation.document.id,
    },
  ]);
}

