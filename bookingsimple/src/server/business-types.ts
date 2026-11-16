import type { AuthDocument } from "./auth-storage";

export const DEFAULT_BUSINESS_TIMEZONE = "Europe/London";
export const DEFAULT_BUSINESS_CURRENCY = "GBP";

export type BusinessStatus = "pending" | "active" | "rejected" | "disabled";

export type BusinessDocument = AuthDocument & {
  type: "business";
  name: string;
  status: BusinessStatus;
  memberCount: number;
  timezone?: string;
  currency?: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessSettingsView = {
  id: string;
  name: string;
  status: BusinessStatus;
  timezone: string;
  currency: string;
  canManage: boolean;
};

export type BusinessInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked";

export type BusinessInvitationDocument = AuthDocument & {
  type: "business-invitation";
  email: string;
  role: "company_user";
  status: BusinessInvitationStatus;
  tokenHash: string;
  invitedByUserId: string;
  acceptedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type BusinessInvitationView = {
  email: string;
  role: "company_user";
  status: BusinessInvitationStatus;
  createdAt: string;
  expiresAt: string;
};

export type BusinessSetupView = {
  business: BusinessSettingsView;
  invitations: BusinessInvitationView[];
};
