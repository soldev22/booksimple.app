"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  BusinessInvitationView,
  BusinessSettingsView,
  BusinessSetupView,
} from "@/server/business-types";
import {
  MAX_REMINDER_OFFSET_MINUTES,
  MAX_REMINDER_RULES,
  REMINDER_CHANNELS,
  type BusinessReminderRule,
  type ReminderChannel,
} from "@/server/reminder-types";
import type {
  StripeConnectionStatus,
  StripeConnectionView,
  StripeOnboardingView,
} from "@/server/stripe-connect-types";

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
    "country" in value &&
    typeof value.country === "string" &&
    "currency" in value &&
    typeof value.currency === "string" &&
    "defaultDepositPercentage" in value &&
    typeof value.defaultDepositPercentage === "number" &&
    Number.isInteger(value.defaultDepositPercentage) &&
    value.defaultDepositPercentage >= 0 &&
    value.defaultDepositPercentage <= 100 &&
    "reminderRules" in value &&
    Array.isArray(value.reminderRules) &&
    value.reminderRules.every(
      (rule) =>
        typeof rule === "object" &&
        rule !== null &&
        "id" in rule &&
        typeof rule.id === "string" &&
        "channel" in rule &&
        REMINDER_CHANNELS.includes(rule.channel as ReminderChannel) &&
        "offsetMinutes" in rule &&
        typeof rule.offsetMinutes === "number" &&
        Number.isSafeInteger(rule.offsetMinutes) &&
        rule.offsetMinutes >= 1 &&
        rule.offsetMinutes <= MAX_REMINDER_OFFSET_MINUTES,
    ) &&
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

function isStripeConnectionStatus(
  value: unknown,
): value is StripeConnectionStatus {
  return [
    "NOT_CONFIGURED",
    "NOT_CONNECTED",
    "ONBOARDING_REQUIRED",
    "RESTRICTED",
    "READY",
  ].includes(String(value));
}

function parseStripeConnection(value: unknown): StripeConnectionView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("connection" in value) ||
    typeof value.connection !== "object" ||
    value.connection === null ||
    !("status" in value.connection) ||
    !isStripeConnectionStatus(value.connection.status) ||
    !("canManage" in value.connection) ||
    typeof value.connection.canManage !== "boolean"
  ) {
    throw new Error("The server returned invalid Stripe connection data.");
  }
  return value.connection as StripeConnectionView;
}

function parseStripeOnboarding(value: unknown): StripeOnboardingView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("onboarding" in value) ||
    typeof value.onboarding !== "object" ||
    value.onboarding === null ||
    !("url" in value.onboarding) ||
    typeof value.onboarding.url !== "string" ||
    !value.onboarding.url.startsWith("https://") ||
    !("mode" in value.onboarding) ||
    !["test", "live"].includes(String(value.onboarding.mode))
  ) {
    throw new Error("The server returned invalid Stripe onboarding data.");
  }
  return value.onboarding as StripeOnboardingView;
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
  stripeResult?: "connected" | "cancelled" | "error";
};

export function BusinessSettingsPanel({
  section,
  stripeResult,
}: BusinessSettingsPanelProps) {
  const [setup, setSetup] = useState<BusinessSetupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [stripeConnection, setStripeConnection] =
    useState<StripeConnectionView | null>(null);
  const [reminderRules, setReminderRules] = useState<
    BusinessReminderRule[]
  >([]);
  const [error, setError] = useState(
    stripeResult === "error"
      ? "Stripe account connection could not be completed. Retry."
      : "",
  );
  const [message, setMessage] = useState(
    stripeResult === "connected"
      ? "The existing Stripe account was connected."
      : stripeResult === "cancelled"
        ? "Stripe account connection was cancelled."
        : "",
  );

  async function load() {
    setError("");
    const nextSetup = parseSetup(await api("/api/business", "GET"));
    setSetup(nextSetup);
    setReminderRules(nextSetup.business.reminderRules);
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
        if (active) {
          const nextSetup = parseSetup(result);
          setSetup(nextSetup);
          setReminderRules(nextSetup.business.reminderRules);
        }
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

  useEffect(() => {
    let active = true;
    api("/api/stripe/connect", "GET")
      .then((result) => {
        if (active) setStripeConnection(parseStripeConnection(result));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Stripe connection status could not be loaded.",
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
      values.reminderRules = JSON.stringify(
        reminderRules.map(({ channel, offsetMinutes }) => ({
          channel,
          offsetMinutes,
        })),
      );
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

  function addReminderRule() {
    if (reminderRules.length >= MAX_REMINDER_RULES) return;
    setReminderRules((current) => [
      ...current,
      {
        id: `draft-${crypto.randomUUID()}`,
        channel: "EMAIL",
        offsetMinutes: 1440,
      },
    ]);
  }

  function updateReminderRule(
    index: number,
    patch: Partial<Pick<BusinessReminderRule, "channel" | "offsetMinutes">>,
  ) {
    setReminderRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function removeReminderRule(index: number) {
    setReminderRules((current) =>
      current.filter((_, ruleIndex) => ruleIndex !== index),
    );
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

  async function startStripeOnboarding() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const onboarding = parseStripeOnboarding(
        await api("/api/stripe/connect/onboarding", "POST", {}),
      );
      window.location.assign(onboarding.url);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Stripe onboarding could not be started.",
      );
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
                <span>Country</span>
                <input name="country" defaultValue={business.country} minLength={2} maxLength={2} required disabled={busy} />
                <small>Use a two-letter country code such as GB, IE or US.</small>
              </label>
              <label className="account-field">
                <span>Currency</span>
                <input name="currency" defaultValue={business.currency} minLength={3} maxLength={3} required disabled={busy} />
                <small>Use a three-letter currency code such as GBP, EUR or USD.</small>
              </label>
              <label className="account-field">
                <span>Default deposit percentage</span>
                <input
                  defaultValue={business.defaultDepositPercentage}
                  disabled={busy}
                  max={100}
                  min={0}
                  name="defaultDepositPercentage"
                  required
                  step={1}
                  type="number"
                />
                <small>
                  Applied to new Bookings only. Use 0 when no deposit is
                  required by default.
                </small>
              </label>
              <fieldset className="account-field">
                <legend>Default booking reminders</legend>
                <small>
                  New Bookings snapshot these rules. Delivery is simulated in
                  Stage 12 and no customer message is sent.
                </small>
                {reminderRules.map((rule, index) => (
                  <div className="booking-status-actions" key={rule.id}>
                    <label className="account-field">
                      <span>Channel</span>
                      <select
                        disabled={busy}
                        onChange={(event) =>
                          updateReminderRule(index, {
                            channel: event.target.value as ReminderChannel,
                          })
                        }
                        value={rule.channel}
                      >
                        {REMINDER_CHANNELS.map((channel) => (
                          <option key={channel} value={channel}>
                            {channel === "META" ? "Facebook / Meta" : channel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="account-field">
                      <span>Minutes before Booking</span>
                      <input
                        disabled={busy}
                        max={MAX_REMINDER_OFFSET_MINUTES}
                        min={1}
                        onChange={(event) =>
                          updateReminderRule(index, {
                            offsetMinutes: Number(event.target.value),
                          })
                        }
                        required
                        step={1}
                        type="number"
                        value={rule.offsetMinutes}
                      />
                    </label>
                    <button
                      className="account-button account-button-secondary"
                      disabled={busy}
                      onClick={() => removeReminderRule(index)}
                      type="button"
                    >
                      Remove reminder
                    </button>
                  </div>
                ))}
                {reminderRules.length < MAX_REMINDER_RULES && (
                  <button
                    className="account-button account-button-secondary"
                    disabled={busy}
                    onClick={addReminderRule}
                    type="button"
                  >
                    Add reminder
                  </button>
                )}
              </fieldset>
              <button className="account-button" disabled={busy} type="submit">
                {busy ? "Saving..." : "Save business settings"}
              </button>
            </form>
          ) : (
            <dl className="business-details">
              <div><dt>Business name</dt><dd>{business.name}</dd></div>
              <div><dt>Timezone</dt><dd>{business.timezone}</dd></div>
              <div><dt>Country</dt><dd>{business.country}</dd></div>
              <div><dt>Currency</dt><dd>{business.currency}</dd></div>
              <div>
                <dt>Default deposit</dt>
                <dd>{business.defaultDepositPercentage}%</dd>
              </div>
              <div>
                <dt>Default reminders</dt>
                <dd>
                  {business.reminderRules.length === 0
                    ? "None"
                    : business.reminderRules
                        .map(
                          (rule) =>
                            `${rule.offsetMinutes} minutes before by ${
                              rule.channel === "META"
                                ? "Facebook / Meta"
                                : rule.channel
                            }`,
                        )
                        .join(", ")}
                </dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {section === "profile" && (
        <section className="account-section" id="stripe-connect">
          <h2>Stripe payments</h2>
          {!stripeConnection ? (
            <p role="status">Loading Stripe connection...</p>
          ) : (
            <>
              <dl className="business-details">
                <div>
                  <dt>Environment</dt>
                  <dd>
                    {stripeConnection.mode === "live"
                      ? "Live"
                      : stripeConnection.mode === "test"
                        ? "Test"
                        : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {stripeConnection.status
                      .toLowerCase()
                      .replaceAll("_", " ")}
                  </dd>
                </div>
                {stripeConnection.accountReference && (
                  <div>
                    <dt>Connected account</dt>
                    <dd>{stripeConnection.accountReference}</dd>
                  </div>
                )}
              </dl>
              <p>
                Customer payments are direct charges to this Business&apos;s
                connected Stripe account. BookSimple currently takes no
                application fee.
              </p>
              {stripeConnection.status === "NOT_CONFIGURED" && (
                <p>
                  Configure the server-side Stripe environment before starting
                  onboarding.
                </p>
              )}
              {stripeConnection.canManage &&
                stripeConnection.status !== "NOT_CONFIGURED" &&
                stripeConnection.status !== "READY" && (
                  <button
                    className="account-button"
                    disabled={busy}
                    onClick={() => void startStripeOnboarding()}
                    type="button"
                  >
                    {busy
                      ? "Opening Stripe..."
                      : stripeConnection.status === "NOT_CONNECTED"
                        ? "Connect an existing Stripe account"
                        : "Reconnect Stripe account"}
                  </button>
                )}
              {stripeConnection.status === "READY" && (
                <p className="account-notice">
                  Stripe is ready to accept direct payments for this Business.
                </p>
              )}
            </>
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
