"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { utcToLocalDateTime } from "@/server/booking-time";
import type {
  BookingStatus,
  BookingView,
} from "@/server/booking-types";
import { formatMinorAmount } from "@/server/money";
import type { CustomerView } from "@/server/customer-types";
import type { ServiceView } from "@/server/service-types";
import {
  customerApi,
  parseCustomerPage,
} from "../customers/customer-client";
import {
  parseServicePage,
  serviceApi,
} from "../services/service-client";
import {
  bookingApi,
  parseBookingPage,
  parseBookingResponse,
} from "./booking-client";
import { loadStaffChoices, type StaffChoice } from "./staff-client";

const statusOptions: { value: BookingStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "AWAITING_DEPOSIT", label: "Awaiting deposit" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No-show" },
];

function displayDate(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(isoDate));
}

export function BookingsPanel({
  canManageServices,
  canManageStaff,
  initialCustomerId,
  initialConversationId,
}: {
  canManageServices: boolean;
  canManageStaff: boolean;
  initialCustomerId?: string;
  initialConversationId?: string;
}) {
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [staff, setStaff] = useState<StaffChoice[]>([]);
  const [suggestedInstant] = useState(() => {
    const nextHour = new Date(Date.now() + 3_600_000);
    nextHour.setUTCMinutes(0, 0, 0);
    return nextHour.toISOString();
  });
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [customerFilter, setCustomerFilter] = useState(
    initialCustomerId ?? "",
  );
  const [timeZone, setTimeZone] = useState("");
  const [continuationToken, setContinuationToken] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasConversationContext = Boolean(
    initialConversationId && initialCustomerId,
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      customerApi("/api/customers?status=active&pageSize=100", "GET"),
      serviceApi("/api/services?status=active&pageSize=100", "GET"),
    ])
      .then(([customerValue, serviceValue]) => {
        if (!active) return;
        setCustomers(parseCustomerPage(customerValue).customers);
        setServices(parseServicePage(serviceValue).services);
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
  }, []);

  useEffect(() => {
    if (!canManageStaff) return;
    const controller = new AbortController();
    loadStaffChoices(controller.signal)
      .then(setStaff)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Staff choices could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [canManageStaff]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      status,
      pageSize: "50",
      ...(customerFilter ? { customerId: customerFilter } : {}),
    });
    bookingApi(`/api/bookings?${query}`, "GET")
      .then((value) => {
        if (!active) return;
        const page = parseBookingPage(value);
        setBookings(page.bookings);
        setTimeZone(page.timeZone);
        setContinuationToken(page.continuationToken);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Bookings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, customerFilter]);

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const booking = parseBookingResponse(
        await bookingApi("/api/bookings", "POST", {
          customerId: values.customerId,
          serviceId: values.serviceId,
          startLocal: values.startLocal,
          ...(canManageStaff && values.staffUserId
            ? { staffUserId: values.staffUserId }
            : {}),
          conversationId: hasConversationContext
            ? initialConversationId
            : "",
        }),
      );
      router.push(`/bookings/${booking.id}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Booking could not be created.",
      );
      setBusy(false);
    }
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
        ...(customerFilter ? { customerId: customerFilter } : {}),
      });
      const page = parseBookingPage(
        await bookingApi(`/api/bookings?${query}`, "GET"),
      );
      setBookings((current) => [...current, ...page.bookings]);
      setContinuationToken(page.continuationToken);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "More Bookings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  let suggestedStart = "";
  if (timeZone) {
    suggestedStart = utcToLocalDateTime(suggestedInstant, timeZone);
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}

      <section className="account-section">
        <h2>Create Booking</h2>
        <p>
          Times use {timeZone || "the Business timezone"}. Duration, amount and
          currency come from the selected Service.
        </p>
        {hasConversationContext && (
          <p className="account-notice">
            This Booking will retain a link to the originating Conversation.
          </p>
        )}
        {customers.length === 0 || services.length === 0 ? (
          <p>
            At least one active Customer and one active Service are required.
            {" "}
            <Link className="customer-action-link" href="/customers">
              Manage Customers
            </Link>
            {canManageServices && (
              <>
                {" "}
                <Link className="customer-action-link" href="/services">
                  Manage Services
                </Link>
              </>
            )}
          </p>
        ) : (
          <form
            className="booking-form-grid"
            key={`${suggestedStart}-${initialCustomerId ?? ""}`}
            onSubmit={createBooking}
          >
            <label className="account-field">
              <span>Customer</span>
              <select
                defaultValue={initialCustomerId ?? ""}
                disabled={busy || hasConversationContext}
                name="customerId"
                required
              >
                <option disabled value="">Choose a Customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
              {hasConversationContext && initialCustomerId && (
                <input
                  name="customerId"
                  type="hidden"
                  value={initialCustomerId}
                />
              )}
            </label>
            {canManageStaff && (
              <label className="account-field">
                <span>Staff member</span>
                <select disabled={busy} name="staffUserId">
                  <option value="">Unassigned</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.username})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="account-field">
              <span>Service</span>
              <select disabled={busy} name="serviceId" required>
                <option disabled value="">Choose a Service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} - {service.durationMinutes} min -{" "}
                    {formatMinorAmount(service.priceMinor, service.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="account-field">
              <span>Start date and time</span>
              <input
                defaultValue={suggestedStart}
                disabled={busy}
                name="startLocal"
                required
                type="datetime-local"
              />
            </label>
            <button className="account-button" disabled={busy} type="submit">
              {busy ? "Creating..." : "Create Booking"}
            </button>
          </form>
        )}
      </section>

      <section className="account-section">
        <h2>Bookings</h2>
        <div className="booking-filters">
          <label className="account-field">
            <span>Status</span>
            <select
              onChange={(event) =>
                {
                  setLoading(true);
                  setError("");
                  setStatus(event.target.value as BookingStatus | "all");
                }
              }
              value={status}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="account-field">
            <span>Customer</span>
            <select
              onChange={(event) => {
                setLoading(true);
                setError("");
                setCustomerFilter(event.target.value);
              }}
              value={customerFilter}
            >
              <option value="">All Customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && bookings.length === 0 ? (
          <p role="status">Loading Bookings...</p>
        ) : bookings.length === 0 ? (
          <p>No Bookings match this view.</p>
        ) : (
          <div className="platform-user-table-wrap">
            <table className="platform-user-table booking-table">
              <caption className="visually-hidden">Bookings</caption>
              <thead>
                <tr>
                  <th scope="col">Start</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Staff</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{displayDate(booking.startAt, booking.timeZone)}</td>
                    <th scope="row">{booking.customerName}</th>
                    <td>{booking.serviceName}</td>
                    <td>{booking.staffName ?? "Unassigned"}</td>
                    <td>
                      {formatMinorAmount(
                        booking.totalAmountMinor,
                        booking.currency,
                      )}
                    </td>
                    <td>
                      <span className={`booking-status booking-status-${booking.status.toLowerCase()}`}>
                        {booking.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="customer-action-link"
                        href={`/bookings/${booking.id}`}
                      >
                        View Booking
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
