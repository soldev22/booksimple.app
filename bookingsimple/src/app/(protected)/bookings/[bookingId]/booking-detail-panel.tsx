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
import type { PaymentView } from "@/server/payment-types";
import type { ReminderView } from "@/server/reminder-types";
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
import {
  parsePaymentList,
  parsePaymentRequest,
  parsePaymentResponse,
  paymentApi,
} from "../payment-client";
import {
  parseReminderList,
  reminderApi,
} from "../reminder-client";

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
  initialPayments,
}: {
  initialBooking: BookingView;
  initialPayments: PaymentView[];
}) {
  const [booking, setBooking] = useState(initialBooking);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [services, setServices] = useState<ServiceView[]>([]);
  const [payments, setPayments] = useState(initialPayments);
  const [reminders, setReminders] = useState<ReminderView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/bookings/${booking.id}`;
  const detailsEditable = !terminalStatuses.includes(booking.status);
  const depositPayment = payments.find(
    (payment) => payment.paymentType === "DEPOSIT",
  );
  const balancePayment = payments.find(
    (payment) => payment.paymentType === "BALANCE",
  );
  const remainingBalance =
    booking.totalAmountMinor - booking.depositAmountMinor;

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

  useEffect(() => {
    let active = true;
    paymentApi(`/api/payments?bookingId=${booking.id}`, "GET")
      .then((value) => {
        if (active) setPayments(parsePaymentList(value));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Payment information could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [booking.id]);

  useEffect(() => {
    let active = true;
    reminderApi(`/api/reminders?bookingId=${booking.id}`)
      .then((value) => {
        if (active) setReminders(parseReminderList(value));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Reminder information could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [booking.id]);

  async function refreshBookingPaymentsAndReminders() {
    const [bookingValue, paymentValue, reminderValue] = await Promise.all([
      bookingApi(endpoint, "GET"),
      paymentApi(`/api/payments?bookingId=${booking.id}`, "GET"),
      reminderApi(`/api/reminders?bookingId=${booking.id}`),
    ]);
    setBooking(parseBookingResponse(bookingValue));
    setPayments(parsePaymentList(paymentValue));
    setReminders(parseReminderList(reminderValue));
  }

  async function updateDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      await bookingApi(endpoint, "PATCH", {
        customerId: values.customerId,
        serviceId: values.serviceId,
        startLocal: values.startLocal,
      });
      await refreshBookingPaymentsAndReminders();
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
      await bookingApi(`${endpoint}/status`, "POST", { status });
      await refreshBookingPaymentsAndReminders();
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

  async function overrideDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      setBooking(
        parseBookingResponse(
          await bookingApi(`${endpoint}/deposit`, "POST", {
            percentage: values.percentage,
          }),
        ),
      );
      setMessage("Booking deposit terms updated.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Booking deposit could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createPayment(paymentType: "DEPOSIT" | "BALANCE") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = parsePaymentRequest(
        await paymentApi("/api/payments", "POST", {
          bookingId: booking.id,
          paymentType,
        }),
      );
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      await refreshBookingPaymentsAndReminders();
      setMessage(
        result.payment.simulated
          ? "Simulated Payment request created. No money was charged."
          : "Payment request is awaiting its provider confirmation.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Payment request could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function simulatePaymentConfirmation(payment: PaymentView) {
      if (busy) return;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        parsePaymentResponse(
          await paymentApi(
            `/api/payments/${payment.id}/simulate`,
            "POST",
            { eventId: crypto.randomUUID() },
          ),
        );
        await refreshBookingPaymentsAndReminders();
        setMessage(
          "Simulated Payment confirmed. No real payment was processed.",
        );
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The simulated Payment could not be confirmed.",
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
          <div>
            <dt>Deposit required</dt>
            <dd>
              {formatMinorAmount(
                booking.depositAmountMinor,
                booking.currency,
              )}{" "}
              ({booking.appliedDepositPercentage}%)
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
        <h2>Booking reminders</h2>
        <p>
          Email reminders are sent automatically. Other channels remain
          pending provider support.
        </p>
        {reminders.length === 0 ? (
          <p>
            This Booking has no reminders. Business defaults apply only when a
            new Booking is created.
          </p>
        ) : (
          <div className="platform-user-table-wrap">
            <table className="platform-user-table">
              <caption className="visually-hidden">
                Scheduled Booking reminders
              </caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Offset</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((reminder) => (
                  <tr key={reminder.id}>
                    <th scope="row">
                      {reminder.channel === "META"
                        ? "Facebook / Meta"
                        : reminder.channel}
                    </th>
                    <td>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: booking.timeZone,
                      }).format(new Date(reminder.scheduledFor))}
                    </td>
                    <td>{reminder.offsetMinutes} minutes before</td>
                    <td className="platform-table-status">
                      {reminder.status.toLowerCase()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="account-section">
        <h2>Deposit terms</h2>
        <dl className="booking-summary">
          <div>
            <dt>Business default at creation</dt>
            <dd>{booking.defaultDepositPercentage}%</dd>
          </div>
          <div>
            <dt>Applied to this Booking</dt>
            <dd>{booking.appliedDepositPercentage}%</dd>
          </div>
          <div>
            <dt>Deposit required</dt>
            <dd>
              {formatMinorAmount(
                booking.depositAmountMinor,
                booking.currency,
              )}
            </dd>
          </div>
          <div>
            <dt>Terms</dt>
            <dd>
              {booking.depositOverridden
                ? `Overridden by ${booking.depositOverriddenByUsername} on ${new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(booking.depositOverriddenAt!))}`
                : "Business default"}
            </dd>
          </div>
        </dl>
        {detailsEditable ? (
          <form className="account-form" onSubmit={overrideDeposit}>
            <label className="account-field">
              <span>Override percentage</span>
              <input
                defaultValue={booking.appliedDepositPercentage}
                disabled={busy}
                max={100}
                min={0}
                name="percentage"
                required
                step={1}
                type="number"
              />
              <small>
                This changes the required deposit for this Booking only. It
                does not record or collect a payment.
              </small>
            </label>
            <button className="account-button" disabled={busy} type="submit">
              {busy ? "Saving..." : "Apply deposit override"}
            </button>
          </form>
        ) : (
          <p>Deposit terms are final for this Booking status.</p>
        )}
      </section>

      <section className="account-section">
        <h2>Deposit Payment</h2>
        {depositPayment?.simulated && (
          <p className="account-notice" role="status">
            Simulation only - no money will be charged.
          </p>
        )}
        {booking.depositAmountMinor === 0 ? (
          <p>This Booking does not require a deposit Payment.</p>
        ) : !depositPayment ? (
          <>
            <p>
              Required deposit:{" "}
              {formatMinorAmount(
                booking.depositAmountMinor,
                booking.currency,
              )}
            </p>
            {detailsEditable && (
              <button
                className="account-button"
                disabled={busy}
                onClick={() => void createPayment("DEPOSIT")}
                type="button"
              >
                {busy
                  ? "Creating..."
                  : "Create deposit payment request"}
              </button>
            )}
          </>
        ) : (
          <>
            <dl className="booking-summary">
              <div>
                <dt>Status</dt>
                <dd>{depositPayment.status}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {formatMinorAmount(
                    depositPayment.amountMinor,
                    depositPayment.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>
                  {depositPayment.simulated
                    ? "Mock test provider (simulated)"
                    : `Stripe (${depositPayment.livemode ? "live" : "test"})`}
                </dd>
              </div>
              {depositPayment.paidAt && (
                <div>
                  <dt>Paid</dt>
                  <dd>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(depositPayment.paidAt))}
                  </dd>
                </div>
              )}
            </dl>
            {depositPayment.status === "PENDING" &&
              depositPayment.simulated &&
              detailsEditable && (
              <button
                className="account-button"
                disabled={busy}
                onClick={() =>
                  void simulatePaymentConfirmation(depositPayment)
                }
                type="button"
              >
                {busy ? "Confirming..." : "Simulate successful payment"}
              </button>
            )}
            {depositPayment.status === "PENDING" &&
              !depositPayment.simulated &&
              detailsEditable && (
                <button
                  className="account-button"
                  disabled={busy}
                  onClick={() => void createPayment("DEPOSIT")}
                  type="button"
                >
                  {busy ? "Opening..." : "Continue to Stripe Checkout"}
                </button>
              )}
            {depositPayment.status === "FAILED" &&
              !depositPayment.simulated &&
              detailsEditable && (
                <button
                  className="account-button"
                  disabled={busy}
                  onClick={() => void createPayment("DEPOSIT")}
                  type="button"
                >
                  {busy ? "Opening..." : "Retry with Stripe Checkout"}
                </button>
              )}
            {depositPayment.status === "PAID" &&
              depositPayment.simulated && (
              <p>
                This is a simulated confirmation. No real payment was
                processed.
              </p>
            )}
          </>
        )}
      </section>

      <section className="account-section">
        <h2>Balance Payment</h2>
        {remainingBalance <= 0 ? (
          <p>This Booking has no remaining balance.</p>
        ) : booking.depositAmountMinor > 0 &&
          depositPayment?.status !== "PAID" ? (
          <p>The deposit must be paid before the balance can be requested.</p>
        ) : !balancePayment ? (
          <>
            <p>
              Remaining balance:{" "}
              {formatMinorAmount(remainingBalance, booking.currency)}
            </p>
            {detailsEditable && (
              <button
                className="account-button"
                disabled={busy}
                onClick={() => void createPayment("BALANCE")}
                type="button"
              >
                {busy ? "Creating..." : "Create balance payment request"}
              </button>
            )}
          </>
        ) : (
          <>
            {balancePayment.simulated && (
              <p className="account-notice" role="status">
                Simulation only - no money will be charged.
              </p>
            )}
            <dl className="booking-summary">
              <div>
                <dt>Status</dt>
                <dd>{balancePayment.status}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {formatMinorAmount(
                    balancePayment.amountMinor,
                    balancePayment.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>
                  {balancePayment.simulated
                    ? "Mock test provider (simulated)"
                    : `Stripe (${balancePayment.livemode ? "live" : "test"})`}
                </dd>
              </div>
              {balancePayment.paidAt && (
                <div>
                  <dt>Paid</dt>
                  <dd>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(balancePayment.paidAt))}
                  </dd>
                </div>
              )}
            </dl>
            {balancePayment.status === "PENDING" &&
              balancePayment.simulated &&
              detailsEditable && (
                <button
                  className="account-button"
                  disabled={busy}
                  onClick={() =>
                    void simulatePaymentConfirmation(balancePayment)
                  }
                  type="button"
                >
                  {busy ? "Confirming..." : "Simulate successful payment"}
                </button>
              )}
            {balancePayment.status === "PENDING" &&
              !balancePayment.simulated &&
              detailsEditable && (
                <button
                  className="account-button"
                  disabled={busy}
                  onClick={() => void createPayment("BALANCE")}
                  type="button"
                >
                  {busy ? "Opening..." : "Continue to Stripe Checkout"}
                </button>
              )}
            {balancePayment.status === "FAILED" &&
              !balancePayment.simulated &&
              detailsEditable && (
                <button
                  className="account-button"
                  disabled={busy}
                  onClick={() => void createPayment("BALANCE")}
                  type="button"
                >
                  {busy ? "Opening..." : "Retry with Stripe Checkout"}
                </button>
              )}
          </>
        )}
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
