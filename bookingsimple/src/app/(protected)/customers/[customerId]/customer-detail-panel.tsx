"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type {
  CustomerDuplicateWarning,
  CustomerView,
} from "@/server/customer-types";
import {
  customerApi,
  parseCustomerResponse,
  parseCustomerResult,
} from "../customer-client";

export function CustomerDetailPanel({
  initialCustomer,
  canPermanentlyErase,
}: {
  initialCustomer: CustomerView;
  canPermanentlyErase: boolean;
}) {
  const [customer, setCustomer] = useState(initialCustomer);
  const [warnings, setWarnings] = useState<CustomerDuplicateWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/customers/${customer.id}`;

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setWarnings([]);
    try {
      const result = parseCustomerResult(
        await customerApi(
          endpoint,
          "PATCH",
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      );
      setCustomer(result.customer);
      setWarnings(result.warnings);
      setMessage("Customer updated.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The customer could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (
      busy ||
      !window.confirm(
        `Archive ${customer.name}? The record will remain available in the archived customer view.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setCustomer(parseCustomerResponse(await customerApi(endpoint, "DELETE")));
      setMessage("Customer archived.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The customer could not be archived.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (
      busy ||
      window.prompt(
        "Permanent erasure removes the customer's name, email and phone. Type ERASE to continue.",
      ) !== "ERASE"
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setWarnings([]);
    try {
      setCustomer(
        parseCustomerResponse(
          await customerApi(`${endpoint}/erase`, "POST", {
            confirmation: "ERASE",
          }),
        ),
      );
      setMessage("Customer personal information permanently erased.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The customer could not be erased.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      {warnings.length > 0 && (
        <div className="customer-warning" role="status">
          <strong>Possible duplicate customer</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning.id}>
                {warning.name} has the same{" "}
                {warning.matchingFields.join(" and ")}. Both records remain
                separate.
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="account-section">
        <div className="customer-detail-heading">
          <div>
            <h2>{customer.name}</h2>
            <span className="customer-status">{customer.status}</span>
          </div>
          <p>Created {new Date(customer.createdAt).toLocaleDateString()}</p>
        </div>

        {customer.status === "active" ? (
          <form
            className="account-form"
            key={customer.updatedAt}
            onSubmit={update}
          >
            <label className="account-field">
              <span>Name</span>
              <input
                defaultValue={customer.name}
                disabled={busy}
                maxLength={120}
                name="name"
                required
              />
            </label>
            <label className="account-field">
              <span>Email</span>
              <input
                autoComplete="email"
                defaultValue={customer.email ?? ""}
                disabled={busy}
                maxLength={254}
                name="email"
                type="email"
              />
            </label>
            <label className="account-field">
              <span>Phone</span>
              <input
                autoComplete="tel"
                defaultValue={customer.phone ?? ""}
                disabled={busy}
                maxLength={40}
                name="phone"
                type="tel"
              />
            </label>
            <div className="customer-actions">
              <button className="account-button" disabled={busy} type="submit">
                {busy ? "Saving..." : "Save customer"}
              </button>
              <button
                className="account-button account-button-secondary"
                disabled={busy}
                onClick={() => void archive()}
                type="button"
              >
                Archive customer
              </button>
            </div>
          </form>
        ) : (
          <dl className="business-details">
            <div><dt>Email</dt><dd>{customer.email ?? "Removed"}</dd></div>
            <div><dt>Phone</dt><dd>{customer.phone ?? "Removed"}</dd></div>
            <div>
              <dt>Last updated</dt>
              <dd>{new Date(customer.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        )}
      </section>

      {canPermanentlyErase && customer.status !== "erased" && (
        <section className="account-section customer-danger-zone">
          <h2>Permanent erasure</h2>
          <p>
            Permanently remove the customer&apos;s name, email and phone while
            retaining only the anonymous record identity needed by future
            bookings and conversations. This cannot be undone.
          </p>
          <button
            className="account-button account-button-danger"
            disabled={busy}
            onClick={() => void erase()}
            type="button"
          >
            Permanently erase personal information
          </button>
        </section>
      )}

      <p className="account-links">
        <Link href={`/bookings?customerId=${customer.id}`}>
          View Customer Bookings
        </Link>
        <Link href="/customers">Back to customers</Link>
      </p>
    </>
  );
}
