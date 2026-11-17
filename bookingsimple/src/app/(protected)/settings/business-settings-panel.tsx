"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  BusinessInvitationView,
  BusinessSettingsView,
  BusinessSetupView,
} from "@/server/business-types";

function isBusiness(value: unknown): value is BusinessSettingsView {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    "timezone" in value &&
    typeof value.timezone === "string" &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "canManage" in value &&
    typeof value.canManage === "boolean"
  );
}

function isInvitation(value: unknown): value is BusinessInvitationView {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof value.email === "string" &&
    "role" in value &&
    value.role === "company_user" &&
    "status" in value &&
    ["pending", "accepted", "revoked"].includes(String(value.status)) &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "string"
  );
}

function parseSetup(value: unknown): BusinessSetupView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("business" in value) ||
    !isBusiness(value.business) ||
    !("invitations" in value) ||
    !Array.isArray(value.invitations) ||
    !value.invitations.every(isInvitation)
  ) {
    throw new Error("The server returned invalid business settings.");
  }
  return {
    business: value.business,
    invitations: value.invitations,
  };
}

async function api(
  endpoint: string,
  method: "GET" | "PATCH" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "The request could not be completed.",
    );
  }
  return result;
}

type BusinessSettingsPanelProps = {
  section: "profile" | "invitations";
};

export function BusinessSettingsPanel({ section }: BusinessSettingsPanelProps) {
  const [setup, setSetup] = useState<BusinessSetupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setError("");
    setSetup(parseSetup(await api("/api/business", "GET")));
  }

  async function deleteInvitation(email: string) {
    if (
      busy ||
      !window.confirm(
        `Delete the pending invitation for ${email}? The emailed link will stop working.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/business/invitations", "DELETE", { email });
      await load();
      setMessage("Invitation deleted.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The invitation could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    api("/api/business", "GET")
      .then((result) => {
        if (active) setSetup(parseSetup(result));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Business settings could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      await api("/api/business", "PATCH", values);
      await load();
      setMessage("Business settings updated.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Business settings could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      await api("/api/business/invitations", "POST", values);
      form.reset();
      await load();
      setMessage("Invitation sent.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The invitation could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!setup && !error) {
    return <p role="status">Loading business settings...</p>;
  }
  if (!setup) {
    return (
      <>
        <p className="account-error" role="alert">{error}</p>
        <button className="account-button" onClick={() => void load()} type="button">
          Retry
        </button>
      </>
    );
  }

  const { business } = setup;
  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}

      {section === "profile" && (
        <section className="account-section" id="business-profile">
          <h2>Business profile</h2>
          {business.canManage ? (
            <form className="account-form" onSubmit={updateSettings}>
              <label className="account-field">
                <span>Business name</span>
                <input name="name" defaultValue={business.name} maxLength={120} required disabled={busy} />
              </label>
              <label className="account-field">
                <span>Timezone</span>
                <input name="timezone" defaultValue={business.timezone} maxLength={100} required disabled={busy} />
                <small>Use an IANA timezone such as Europe/London.</small>
              </label>
              <label className="account-field">
                <span>Currency</span>
                <input name="currency" defaultValue={business.currency} minLength={3} maxLength={3} required disabled={busy} />
                <small>Use a three-letter currency code such as GBP, EUR or USD.</small>
              </label>
              <button className="account-button" disabled={busy} type="submit">
                {busy ? "Saving..." : "Save business settings"}
              </button>
            </form>
          ) : (
            <dl className="business-details">
              <div><dt>Business name</dt><dd>{business.name}</dd></div>
              <div><dt>Timezone</dt><dd>{business.timezone}</dd></div>
              <div><dt>Currency</dt><dd>{business.currency}</dd></div>
            </dl>
          )}
        </section>
      )}

      {section === "invitations" && business.canManage && (
        <section className="account-section">
          <h2>Invite a company user</h2>
          <p>Invited users receive staff-level access to this business. Platform and company-administrator access cannot be granted here.</p>
          <form className="account-form" onSubmit={invite}>
            <label className="account-field">
              <span>Email address</span>
              <input name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy} />
            </label>
            <button className="account-button" disabled={busy} type="submit">
              {busy ? "Sending..." : "Send invitation"}
            </button>
          </form>
          {setup.invitations.length > 0 && (
            <div>
              <h3>Invitations</h3>
              <div className="platform-user-table-wrap">
                <table className="platform-user-table">
                  <caption className="visually-hidden">Pending company invitations</caption>
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Status</th>
                      <th scope="col">Sent</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setup.invitations.map((invitation) => (
                      <tr key={`${invitation.email}-${invitation.createdAt}`}>
                        <th scope="row">{invitation.email}</th>
                        <td className="platform-table-status">{invitation.status}</td>
                        <td>{new Date(invitation.createdAt).toLocaleDateString()}</td>
                        <td>{new Date(invitation.expiresAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="account-button account-button-secondary"
                            disabled={busy}
                            onClick={() => void deleteInvitation(invitation.email)}
                            type="button"
                          >
                            Delete invitation
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
