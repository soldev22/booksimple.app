"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatMinorAmount } from "@/server/money";
import type { ServiceView } from "@/server/service-types";
import {
  parseServicePage,
  parseServiceResponse,
  serviceApi,
} from "./service-client";

export function ServicesPanel({ canCreate }: { canCreate: boolean }) {
  const [services, setServices] = useState<ServiceView[]>([]);
  const [defaultCurrency, setDefaultCurrency] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [queryVersion, setQueryVersion] = useState(0);
  const [continuationToken, setContinuationToken] = useState<string>();
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
    serviceApi(`/api/services?${query}`, "GET")
      .then((result) => {
        if (!active) return;
        const page = parseServicePage(result);
        setServices(page.services);
        setDefaultCurrency(page.defaultCurrency);
        setContinuationToken(page.continuationToken);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Services could not be loaded.",
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

  function searchServices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSubmittedSearch(search.trim());
    setQueryVersion((version) => version + 1);
  }

  async function loadMore() {
    if (!continuationToken || loading) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        status,
        pageSize: "50",
        continuationToken,
        ...(submittedSearch ? { search: submittedSearch } : {}),
      });
      const page = parseServicePage(
        await serviceApi(`/api/services?${query}`, "GET"),
      );
      setServices((current) => [...current, ...page.services]);
      setDefaultCurrency(page.defaultCurrency);
      setContinuationToken(page.continuationToken);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "More Services could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const form = event.currentTarget;
      const service = parseServiceResponse(
        await serviceApi(
          "/api/services",
          "POST",
          Object.fromEntries(new FormData(form)),
        ),
      );
      form.reset();
      setMessage(`${service.name} was created.`);
      setLoading(true);
      setStatus("active");
      setSubmittedSearch("");
      setSearch("");
      setQueryVersion((version) => version + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Service could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}

      {canCreate && (
        <section className="account-section">
          <h2>Add Service</h2>
          <p>
            Prices use the selected currency and are stored exactly in minor
            units. Zero-priced Services are allowed.
          </p>
          <form className="service-form-grid" onSubmit={createService}>
          <label className="account-field">
            <span>Name</span>
            <input
              disabled={busy || !defaultCurrency}
              maxLength={120}
              name="name"
              required
            />
          </label>
          <label className="account-field service-description-field">
            <span>Description</span>
            <textarea
              disabled={busy || !defaultCurrency}
              maxLength={1_000}
              name="description"
            />
          </label>
          <label className="account-field">
            <span>Duration in minutes</span>
            <input
              disabled={busy || !defaultCurrency}
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
              disabled={busy || !defaultCurrency}
              inputMode="decimal"
              name="price"
              placeholder="25.50"
              required
            />
          </label>
          <label className="account-field">
            <span>Currency</span>
            <input
              defaultValue={defaultCurrency}
              disabled={busy || !defaultCurrency}
              key={defaultCurrency}
              maxLength={3}
              minLength={3}
              name="currency"
              required
            />
          </label>
          <button
            className="account-button"
            disabled={busy || !defaultCurrency}
            type="submit"
          >
            {busy ? "Creating..." : "Create Service"}
          </button>
          </form>
        </section>
      )}

      <section className="account-section">
        <h2>Services</h2>
        <form className="service-search" onSubmit={searchServices}>
          <label className="account-field">
            <span>Search</span>
            <input
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or description"
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
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
          <button className="account-button" type="submit">Search</button>
        </form>

        {loading && services.length === 0 ? (
          <p role="status">Loading Services...</p>
        ) : services.length === 0 ? (
          <p>No Services match this view.</p>
        ) : (
          <div className="platform-user-table-wrap">
            <table className="platform-user-table service-table">
              <caption className="visually-hidden">Services</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <th scope="row">{service.name}</th>
                    <td>{service.durationMinutes} minutes</td>
                    <td>
                      {formatMinorAmount(service.priceMinor, service.currency)}
                    </td>
                    <td className="platform-table-status">
                      {service.active ? "Active" : "Inactive"}
                    </td>
                    <td>{new Date(service.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <Link
                        className="customer-action-link"
                        href={`/services/${service.id}`}
                      >
                        View Service
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

    </>
  );
}
