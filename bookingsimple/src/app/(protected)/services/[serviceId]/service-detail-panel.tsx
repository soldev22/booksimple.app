"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  formatMinorAmount,
  minorAmountToInput,
} from "@/server/money";
import type { ServiceView } from "@/server/service-types";
import { parseServiceResponse, serviceApi } from "../service-client";

export function ServiceDetailPanel({
  initialService,
}: {
  initialService: ServiceView;
}) {
  const [service, setService] = useState(initialService);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/services/${service.id}`;

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setService(
        parseServiceResponse(
          await serviceApi(
            endpoint,
            "PATCH",
            Object.fromEntries(new FormData(event.currentTarget)),
          ),
        ),
      );
      setMessage("Service updated.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Service could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (
      busy ||
      !window.confirm(
        `${service.active ? "Deactivate" : "Activate"} ${service.name}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const active = !service.active;
      setService(
        parseServiceResponse(
          await serviceApi(`${endpoint}/status`, "POST", { active }),
        ),
      );
      setMessage(`Service ${active ? "activated" : "deactivated"}.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Service status could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}

      <section className="account-section">
        <div className="customer-detail-heading">
          <div>
            <h2>{service.name}</h2>
            <span className="customer-status">
              {service.active ? "Active" : "Inactive"}
            </span>
          </div>
          <p>
            {service.durationMinutes} minutes ·{" "}
            {formatMinorAmount(service.priceMinor, service.currency)}
          </p>
        </div>

        <form
          className="account-form"
          key={service.updatedAt}
          onSubmit={update}
        >
          <label className="account-field">
            <span>Name</span>
            <input
              defaultValue={service.name}
              disabled={busy}
              maxLength={120}
              name="name"
              required
            />
          </label>
          <label className="account-field">
            <span>Description</span>
            <textarea
              defaultValue={service.description ?? ""}
              disabled={busy}
              maxLength={1_000}
              name="description"
            />
          </label>
          <label className="account-field">
            <span>Duration in minutes</span>
            <input
              defaultValue={service.durationMinutes}
              disabled={busy}
              inputMode="numeric"
              min="1"
              name="durationMinutes"
              required
              step="1"
              type="number"
            />
          </label>
          <label className="account-field">
            <span>Price</span>
            <input
              defaultValue={minorAmountToInput(
                service.priceMinor,
                service.currency,
              )}
              disabled={busy}
              inputMode="decimal"
              name="price"
              required
            />
          </label>
          <label className="account-field">
            <span>Currency</span>
            <input
              defaultValue={service.currency}
              disabled={busy}
              maxLength={3}
              minLength={3}
              name="currency"
              required
            />
          </label>
          <div className="customer-actions">
            <button className="account-button" disabled={busy} type="submit">
              {busy ? "Saving..." : "Save Service"}
            </button>
            <button
              className="account-button account-button-secondary"
              disabled={busy}
              onClick={() => void toggleActive()}
              type="button"
            >
              {service.active ? "Deactivate Service" : "Activate Service"}
            </button>
          </div>
        </form>
      </section>

      <p className="account-links">
        <Link href="/services">Back to Services</Link>
      </p>
    </>
  );
}
