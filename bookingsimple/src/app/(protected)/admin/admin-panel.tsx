"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { UserView } from "@/server/auth-types";
import { submitAccountAction } from "@/app/components/account-form";

type BusinessView = { id: string; name: string; status: string };
type AdminData = {
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
    !("status" in value && ["pending", "active", "disabled"].includes(String(value.status))) ||
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
      typeof business.status !== "string"
    ) throw new Error("The server returned invalid business data.");
    businesses.push({ id: business.id, name: business.name, status: business.status });
  }
  return {
    users: value.users,
    businesses,
    usersCursor: "usersCursor" in value && typeof value.usersCursor === "string" ? value.usersCursor : undefined,
    businessesCursor: "businessesCursor" in value && typeof value.businessesCursor === "string" ? value.businessesCursor : undefined,
  };
}

async function loadData(query = ""): Promise<AdminData> {
  const response = await fetch(`/api/admin${query}`, { cache: "no-store" });
  const data: unknown = await response.json();
  if (!response.ok) {
    throw new Error(typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error : "Administration could not be loaded.");
  }
  return parseData(data);
}

function AssignmentForm({
  user,
  businesses,
  busy,
  assign,
}: {
  user: UserView;
  businesses: BusinessView[];
  busy: boolean;
  assign: (body: Record<string, unknown>) => Promise<void>;
}) {
  const available = businesses.filter((business) => business.status === "active");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await assign({ ...values, userId: user.id });
  }
  return (
    <form className="assignment-form" onSubmit={submit}>
      <label className="account-field">
        <span>Business</span>
        <select name="tenantId" required defaultValue={user.membership?.tenantId ?? ""} disabled={busy}>
          <option value="" disabled>Select a business</option>
          {available.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
        </select>
      </label>
      <label className="account-field">
        <span>Company username</span>
        <input name="username" required maxLength={50} defaultValue={user.membership?.username ?? ""} disabled={busy} />
      </label>
      <label className="account-field">
        <span>Company role</span>
        <select name="role" defaultValue={user.membership?.role ?? "company_user"} disabled={busy}>
          <option value="company_user">Company user</option>
          <option value="company_admin">Company administrator</option>
        </select>
      </label>
      <button className="account-button" disabled={busy || !user.emailVerified} type="submit">Assign company role</button>
    </form>
  );
}

export function AdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadData().then((result) => { if (active) setData(result); })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Unable to load administration.");
      });
    return () => { active = false; };
  }, []);

  async function change(action: string, body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await submitAccountAction(`/api/admin/${action}`, body);
      setMessage(result.message ?? "Change saved.");
      setData(await loadData());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The change could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function more() {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    const query = new URLSearchParams();
    if (data.usersCursor) query.set("usersCursor", data.usersCursor);
    if (data.businessesCursor) query.set("businessesCursor", data.businessesCursor);
    try {
      const next = await loadData(`?${query}`);
      const users = new Map(data.users.map((user) => [user.id, user]));
      const businesses = new Map(data.businesses.map((business) => [business.id, business]));
      next.users.forEach((user) => users.set(user.id, user));
      next.businesses.forEach((business) => businesses.set(business.id, business));
      setData({
        users: [...users.values()],
        businesses: [...businesses.values()],
        usersCursor: data.usersCursor ? next.usersCursor : undefined,
        businessesCursor: data.businessesCursor ? next.businessesCursor : undefined,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to load the next page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="account-links"><Link href="/account">Account and sign out</Link></p>
      <p className="account-notice">Platform access spans all businesses. Assign platform privileges only to trusted, verified users.</p>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      {!data && !error && <p role="status">Loading registered users...</p>}
      {!data && error && <button className="account-button" onClick={() => {
        setError("");
        loadData().then(setData).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Unable to load administration."));
      }}>Retry</button>}
      {data?.users.length === 0 && <p>No registered users yet.</p>}
      {data?.users.map((user) => (
        <article className="admin-user" key={user.id}>
          <h2>{user.name || user.email}</h2>
          <p>{user.email} · {user.status} · {user.platformAdmin ? "Platform administrator" : user.membership?.role.replaceAll("_", " ") ?? "Unassigned"}</p>
          <p>Email {user.emailVerified ? "verified" : "not verified"}.</p>
          {user.application && (
            <div className="account-section">
              <p>Business application: <strong>{user.application.businessName}</strong> ({user.application.status})</p>
              {user.application.status === "pending" && (
                <div className="account-actions">
                  <button className="account-button" disabled={busy || !user.emailVerified} onClick={() => change("approve", { userId: user.id })}>Approve business</button>
                  <button className="account-button account-button-secondary" disabled={busy} onClick={() => {
                    if (window.confirm(`Reject the business application for ${user.application?.businessName}?`)) void change("reject", { userId: user.id });
                  }}>Reject application</button>
                </div>
              )}
              {user.application.status === "approved" && (
                <button className="account-button account-button-secondary" disabled={busy || !user.emailVerified}
                  onClick={() => change("approve", { userId: user.id })}>
                  Retry approval or notification
                </button>
              )}
            </div>
          )}
          <details className="account-section">
            <summary>Manage roles</summary>
            <AssignmentForm user={user} businesses={data.businesses} busy={busy} assign={(body) => change("assign", body)} />
            <button
              className="account-button account-button-secondary"
              disabled={busy || (!user.platformAdmin && !user.emailVerified)}
              onClick={() => {
                if (window.confirm(`${user.platformAdmin ? "Remove" : "Grant"} platform-administrator access for ${user.email}?`)) {
                  void change("platform-role", { userId: user.id, enabled: !user.platformAdmin });
                }
              }}
            >{user.platformAdmin ? "Remove platform access" : "Grant platform access"}</button>
          </details>
        </article>
      ))}
      {data && (data.usersCursor || data.businessesCursor) && (
        <button className="account-button" disabled={busy} onClick={more}>Load more users and businesses</button>
      )}
    </>
  );
}
