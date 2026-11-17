"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type {
  CustomerDuplicateWarning,
  CustomerView,
} from "@/server/customer-types";
import {
  customerApi,
  parseCustomerPage,
  parseCustomerResult,
} from "./customer-client";

function DuplicateWarnings({
  warnings,
}: {
  warnings: CustomerDuplicateWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="customer-warning" role="status">
      <strong>Possible duplicate customer</strong>
      <ul>
        {warnings.map((warning) => (
          <li key={warning.id}>
            {warning.name} has the same {warning.matchingFields.join(" and ")}.
            The new record was kept separate.
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CustomersPanel() {
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [queryVersion, setQueryVersion] = useState(0);
  const [continuationToken, setContinuationToken] = useState<string>();
  const [warnings, setWarnings] = useState<CustomerDuplicateWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      status,
      pageSize: "50",
      ...(submittedSearch ? { search: submittedSearch } : {}),
    });
    customerApi(`/api/customers?${query}`, "GET")
      .then((result) => {
        if (!active) return;
        const page = parseCustomerPage(result);
        setCustomers(page.customers);
        setContinuationToken(page.continuationToken);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Customers could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, submittedSearch, queryVersion]);

  function searchCustomers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSubmittedSearch(search.trim());
    setQueryVersion((version) => version + 1);
  }

  async function loadMore() {
    if (!continuationToken || loading) return;
    if (status !== "active" || submittedSearch) setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        status,
        pageSize: "50",
        continuationToken,
        ...(submittedSearch ? { search: submittedSearch } : {}),
      });
      const page = parseCustomerPage(
        await customerApi(`/api/customers?${query}`, "GET"),
      );
      setCustomers((current) => [...current, ...page.customers]);
      setContinuationToken(page.continuationToken);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "More customers could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setWarnings([]);
    try {
      const form = event.currentTarget;
      const result = parseCustomerResult(
        await customerApi(
          "/api/customers",
          "POST",
          Object.fromEntries(new FormData(form)),
        ),
      );
      form.reset();
      setWarnings(result.warnings);
      setMessage(`${result.customer.name} was created.`);
      setLoading(true);
      setStatus("active");
      setSubmittedSearch("");
      setSearch("");
      setCustomers((current) => [
        result.customer,
        ...current.filter((customer) => customer.id !== result.customer.id),
      ]);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The customer could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <DuplicateWarnings warnings={warnings} />

      <section className="account-section">
        <h2>Add customer</h2>
        <p>
          Email and phone are optional. Shared contact details are allowed and
          produce a warning rather than merging people.
        </p>
        <form className="customer-form-grid" onSubmit={createCustomer}>
          <label className="account-field">
            <span>Name</span>
            <input disabled={busy} maxLength={120} name="name" required />
          </label>
          <label className="account-field">
            <span>Email</span>
            <input
              autoComplete="email"
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
              disabled={busy}
              maxLength={40}
              name="phone"
              type="tel"
            />
          </label>
          <button className="account-button" disabled={busy} type="submit">
            {busy ? "Creating..." : "Create customer"}
          </button>
        </form>
      </section>

      <section className="account-section">
        <h2>Customers</h2>
        <form className="customer-search" onSubmit={searchCustomers}>
          <label className="account-field">
            <span>Search</span>
            <input
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or phone"
              value={search}
            />
          </label>
          <label className="account-field">
            <span>Status</span>
            <select
              onChange={(event) => {
                setLoading(true);
                setError("");
                setStatus(event.target.value);
              }}
              value={status}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="erased">Erased</option>
              <option value="all">All</option>
            </select>
          </label>
          <button className="account-button" type="submit">Search</button>
        </form>

        {loading && customers.length === 0 ? (
          <p role="status">Loading customers...</p>
        ) : customers.length === 0 ? (
          <p>No customers match this view.</p>
        ) : (
          <div className="platform-user-table-wrap">
            <table className="platform-user-table customer-table">
              <caption className="visually-hidden">Customers</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <th scope="row">{customer.name}</th>
                    <td>{customer.email ?? "—"}</td>
                    <td>{customer.phone ?? "—"}</td>
                    <td className="platform-table-status">{customer.status}</td>
                    <td>{new Date(customer.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <Link
                        className="customer-action-link"
                        href={`/customers/${customer.id}`}
                      >
                        View customer
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {continuationToken && (
          <button
            className="account-button account-button-secondary customer-load-more"
            disabled={loading}
            onClick={() => void loadMore()}
            type="button"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        )}
      </section>

      <p className="account-links">
        <Link href="/">Back to workspace</Link>
      </p>
    </>
  );
}
