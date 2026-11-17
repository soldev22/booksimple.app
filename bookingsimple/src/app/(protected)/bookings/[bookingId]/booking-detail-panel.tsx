"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { utcToLocalDateTime } from "@/server/booking-time";
import {
  BOOKING_STATUSES,
  type BookingStatus,
  type BookingView,
} from "@/server/booking-types";
import { formatMinorAmount } from "@/server/money";
import type { CustomerView } from "@/server/customer-types";
import type { ServiceView } from "@/server/service-types";
import {
  customerApi,
  parseCustomerPage,
  parseCustomerResponse,
} from "../../customers/customer-client";
import {
  parseServicePage,
  parseServiceResponse,
  serviceApi,
} from "../../services/service-client";
import {
  bookingApi,
  parseBookingResponse,
} from "../booking-client";

const terminalStatuses: BookingStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

function statusLabel(status: BookingStatus): string {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function BookingDetailPanel({
  initialBooking,
}: {
  initialBooking: BookingView;
}) {
  const [booking, setBooking] = useState(initialBooking);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/bookings/${booking.id}`;
  const detailsEditable = !terminalStatuses.includes(booking.status);

  useEffect(() => {
    let active = true;
    Promise.all([
      customerApi("/api/customers?status=active&pageSize=100", "GET"),
      serviceApi("/api/services?status=active&pageSize=100", "GET"),
    ])
      .then(async ([customerValue, serviceValue]) => {
        const customerPage = parseCustomerPage(customerValue);
        const servicePage = parseServicePage(serviceValue);
        let nextCustomers = customerPage.customers;
        let nextServices = servicePage.services;
        if (!nextCustomers.some((customer) => customer.id === booking.customerId)) {
          const current = parseCustomerResponse(
            await customerApi(
              `/api/customers/${booking.customerId}`,
              "GET",
            ),
          );
          nextCustomers = [current, ...nextCustomers];
        }
        if (!nextServices.some((service) => service.id === booking.serviceId)) {
          const current = parseServiceResponse(
            await serviceApi(`/api/services/${booking.serviceId}`, "GET"),
          );
          nextServices = [current, ...nextServices];
        }
        if (active) {
          setCustomers(nextCustomers);
          setServices(nextServices);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Booking choices could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [booking.customerId, booking.serviceId]);

  async function updateDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      setBooking(
        parseBookingResponse(
          await bookingApi(endpoint, "PATCH", {
            customerId: values.customerId,
            serviceId: values.serviceId,
            startLocal: values.startLocal,
          }),
        ),
      );
      setMessage("Booking details updated.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Booking could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status: BookingStatus) {
    if (busy || status === booking.status) return;
    if (
      status === "CANCELLED" &&
      !window.confirm("Cancel this Booking? It will remain in the history.")
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setBooking(
        parseBookingResponse(
          await bookingApi(`${endpoint}/status`, "POST", { status }),
        ),
      );
      setMessage(`Booking status changed to ${statusLabel(status)}.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Booking status could not be changed.",
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
        <div className="booking-detail-heading">
          <div>
            <h2>{booking.customerName}</h2>
            <p>{booking.serviceName}</p>
          </div>
          <span className={`booking-status booking-status-${booking.status.toLowerCase()}`}>
            {statusLabel(booking.status)}
          </span>
        </div>
        <dl className="booking-summary">
          <div>
            <dt>Start</dt>
            <dd>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "full",
                timeStyle: "short",
                timeZone: booking.timeZone,
              }).format(new Date(booking.startAt))}
            </dd>
          </div>
          <div>
            <dt>End</dt>
            <dd>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "full",
                timeStyle: "short",
                timeZone: booking.timeZone,
              }).format(new Date(booking.endAt))}
            </dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{booking.timeZone}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{booking.durationMinutes} minutes</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              {formatMinorAmount(
                booking.totalAmountMinor,
                booking.currency,
              )}
            </dd>
          </div>
        </dl>
        <div className="booking-related-links">
          <Link
            className="customer-action-link"
            href={`/customers/${booking.customerId}`}
          >
            View Customer
          </Link>
          <Link
            className="customer-action-link"
            href={`/services/${booking.serviceId}`}
          >
            View Service
          </Link>
          {booking.conversationId && (
            <Link
              className="customer-action-link"
              href={`/inbox/${booking.conversationId}`}
            >
              View Conversation
            </Link>
          )}
        </div>
      </section>

      <section className="account-section">
        <h2>Booking status</h2>
        <div className="booking-status-actions">
          <label className="account-field">
            <span>Status</span>
            <select
              disabled={busy || !detailsEditable}
              onChange={(event) =>
                void updateStatus(event.target.value as BookingStatus)
              }
              value={booking.status}
            >
              {BOOKING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          {detailsEditable && booking.status !== "CANCELLED" && (
            <button
              className="account-button account-button-danger"
              disabled={busy}
              onClick={() => void updateStatus("CANCELLED")}
              type="button"
            >
              Cancel Booking
            </button>
          )}
        </div>
      </section>

      <section className="account-section">
        <h2>Edit Booking</h2>
        {!detailsEditable ? (
          <p>
            Completed, cancelled and no-show Bookings retain their recorded
            details and cannot be edited.
          </p>
        ) : (
          <form
            className="booking-form-grid"
            key={booking.updatedAt}
            onSubmit={updateDetails}
          >
            <label className="account-field">
              <span>Customer</span>
              <select
                defaultValue={booking.customerId}
                disabled={busy || Boolean(booking.conversationId)}
                name="customerId"
                required
              >
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.status !== "active"
                      ? ` (${customer.status})`
                      : ""}
                  </option>
                ))}
              </select>
              {booking.conversationId && (
                <input
                  name="customerId"
                  type="hidden"
                  value={booking.customerId}
                />
              )}
            </label>
            <label className="account-field">
              <span>Service</span>
              <select
                defaultValue={booking.serviceId}
                disabled={busy}
                name="serviceId"
                required
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {!service.active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="account-field">
              <span>Start date and time</span>
              <input
                defaultValue={utcToLocalDateTime(
                  booking.startAt,
                  booking.timeZone,
                )}
                disabled={busy}
                name="startLocal"
                required
                type="datetime-local"
              />
            </label>
            <button className="account-button" disabled={busy} type="submit">
              {busy ? "Saving..." : "Save Booking"}
            </button>
          </form>
        )}
      </section>

      <p className="account-links">
        <Link href="/bookings">Back to Bookings</Link>
      </p>
    </>
  );
}
