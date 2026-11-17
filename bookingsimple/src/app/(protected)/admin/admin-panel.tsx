"use client";

import { type FormEvent } from "react";
import type { BusinessView, UserView } from "@/server/auth-types";

export type AdminData = {
  users: UserView[];
  businesses: BusinessView[];
  usersCursor?: string;
  businessesCursor?: string;
};

function isUser(value: unknown): value is UserView {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("id" in value && typeof value.id === "string") ||
    !("email" in value && typeof value.email === "string") ||
    !("name" in value && typeof value.name === "string") ||
    !("status" in value && ["pending", "active", "disabled", "deleted"].includes(String(value.status))) ||
    !("platformAdmin" in value && typeof value.platformAdmin === "boolean") ||
    !("emailVerified" in value && typeof value.emailVerified === "boolean") ||
    !("mfaEnabled" in value && typeof value.mfaEnabled === "boolean")
  ) return false;
  if ("membership" in value && value.membership !== undefined) {
    const membership = value.membership;
    if (
      typeof membership !== "object" || membership === null ||
      !("tenantId" in membership && typeof membership.tenantId === "string") ||
      !("username" in membership && typeof membership.username === "string") ||
      !("role" in membership && ["company_admin", "company_user"].includes(String(membership.role)))
    ) return false;
  }
  if ("application" in value && value.application !== undefined) {
    const application = value.application;
    if (
      typeof application !== "object" || application === null ||
      !("businessId" in application && typeof application.businessId === "string") ||
      !("businessName" in application && typeof application.businessName === "string") ||
      !("status" in application && ["pending", "approved", "rejected"].includes(String(application.status)))
    ) return false;
  }
  return true;
}

function parseData(value: unknown): AdminData {
  if (typeof value !== "object" || value === null || !("users" in value) || !("businesses" in value)) {
    throw new Error("The server returned invalid administration data.");
  }
  if (!Array.isArray(value.users) || !value.users.every(isUser)) {
    throw new Error("The server returned invalid user data.");
  }
  const businesses: BusinessView[] = [];
  if (!Array.isArray(value.businesses)) throw new Error("The server returned invalid business data.");
  for (const business of value.businesses) {
    if (
      typeof business !== "object" || business === null ||
      typeof business.id !== "string" || typeof business.name !== "string" ||
      !["pending", "active", "rejected", "disabled"].includes(String(business.status)) ||
      typeof business.memberCount !== "number" ||
      typeof business.createdAt !== "string"
    ) throw new Error("The server returned invalid business data.");
    businesses.push({
      id: business.id,
      name: business.name,
      status: business.status as BusinessView["status"],
      memberCount: business.memberCount,
      createdAt: business.createdAt,
    });
  }
  return {
    users: value.users,
    businesses,
    usersCursor: "usersCursor" in value && typeof value.usersCursor === "string" ? value.usersCursor : undefined,
    businessesCursor: "businessesCursor" in value && typeof value.businessesCursor === "string" ? value.businessesCursor : undefined,
  };
}

export async function loadData(query = "", signal?: AbortSignal): Promise<AdminData> {
  const response = await fetch(`/api/admin${query}`, { cache: "no-store", signal });
  const data: unknown = await response.json();
  if (!response.ok) {
    throw new Error(typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error : "Administration could not be loaded.");
  }
  return parseData(data);
}

export function AssignmentForm({
  user,
  businesses,
  busy,
  lockBusiness = false,
  assign,
}: {
  user: UserView;
  businesses: BusinessView[];
  busy: boolean;
  lockBusiness?: boolean;
  assign: (body: Record<string, unknown>) => Promise<void>;
}) {
  const available = businesses.filter((business) => business.status === "active");
  const selectedBusiness = available.find(
    (business) => business.id === user.membership?.tenantId,
  ) ?? (lockBusiness && available.length === 1 ? available[0] : undefined);
  const membershipUsername =
    user.membership?.username ?? `owner_${user.id.replaceAll("-", "").slice(0, 10)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await assign({
      ...values,
      userId: user.id,
      username: membershipUsername,
    });
  }
  return (
    <form className="assignment-form" onSubmit={submit}>
      <label className="account-field">
        <span>Registered name</span>
        <input value={user.name} readOnly />
      </label>
      <label className="account-field">
        <span>Business</span>
        {lockBusiness && selectedBusiness ? (
          <>
            <input value={selectedBusiness.name} readOnly />
            <input name="tenantId" type="hidden" value={selectedBusiness.id} />
          </>
        ) : (
          <select name="tenantId" required defaultValue={user.membership?.tenantId ?? ""} disabled={busy}>
            <option value="" disabled>Select a business</option>
            {available.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
          </select>
        )}
      </label>
      <label className="account-field">
        <span>Company role</span>
        <select name="role" defaultValue={user.membership?.role ?? "company_user"} disabled={busy}>
          <option value="company_user">Company user</option>
          <option value="company_admin">Company administrator</option>
        </select>
      </label>
      <button className="account-button" disabled={busy || !user.emailVerified} type="submit">
        {user.membership ? "Update company role" : "Assign company role"}
      </button>
    </form>
  );
}
