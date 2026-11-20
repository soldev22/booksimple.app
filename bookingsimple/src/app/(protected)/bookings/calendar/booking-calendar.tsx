"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  bookingCalendarRange,
  type BookingCalendarView,
  utcToLocalDateTime,
} from "@/server/booking-time";
import type { BookingView } from "@/server/booking-types";
import {
  bookingApi,
  parseBookingPage,
} from "../booking-client";

const viewOptions: { label: string; value: BookingCalendarView }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
];

function shiftDate(
  localDate: string,
  view: BookingCalendarView,
  direction: -1 | 1,
): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (view === "month") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
  } else {
    date.setUTCDate(date.getUTCDate() + direction * (view === "week" ? 7 : 1));
  }
  return date.toISOString().slice(0, 10);
}

function localDateLabel(localDate: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}

function periodLabel(
  localDates: string[],
  view: BookingCalendarView,
): string {
  if (view === "month") {
    return localDateLabel(localDates[0], { month: "long", year: "numeric" });
  }
  if (view === "day") {
    return localDateLabel(localDates[0], {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return `${localDateLabel(localDates[0], {
    day: "numeric",
    month: "short",
  })} - ${localDateLabel(localDates.at(-1) ?? localDates[0], {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export function BookingCalendar({
  initialLocalDate,
  timeZone,
}: {
  initialLocalDate: string;
  timeZone: string;
}) {
  const [view, setView] = useState<BookingCalendarView>("day");
  const [selectedDate, setSelectedDate] = useState(initialLocalDate);
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(
    () => bookingCalendarRange(selectedDate, view, timeZone),
    [selectedDate, timeZone, view],
  );

  useEffect(() => {
    let active = true;
    async function loadBookings() {
      setLoading(true);
      setError("");
      try {
        const loaded: BookingView[] = [];
        const seenTokens = new Set<string>();
        let continuationToken: string | undefined;
        do {
          const query = new URLSearchParams({
            status: "all",
            pageSize: "100",
            startAtFrom: range.startAt,
            startAtTo: range.endAt,
            ...(continuationToken ? { continuationToken } : {}),
          });
          const page = parseBookingPage(
            await bookingApi(`/api/bookings?${query}`, "GET"),
          );
          loaded.push(...page.bookings);
          continuationToken = page.continuationToken;
          if (continuationToken) {
            if (seenTokens.has(continuationToken)) {
              throw new Error("The Booking calendar paging response repeated.");
            }
            seenTokens.add(continuationToken);
          }
        } while (continuationToken);
        if (active) setBookings(loaded);
      } catch (failure) {
        if (active) {
          setBookings([]);
          setError(
            failure instanceof Error
              ? failure.message
              : "The Booking calendar could not be loaded.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadBookings();
    return () => {
      active = false;
    };
  }, [range.endAt, range.startAt]);

  const bookingsByDate = useMemo(() => {
    const grouped = new Map<string, BookingView[]>();
    for (const localDate of range.localDates) grouped.set(localDate, []);
    for (const booking of bookings) {
      const localDate = utcToLocalDateTime(booking.startAt, timeZone).slice(
        0,
        10,
      );
      grouped.get(localDate)?.push(booking);
    }
    return grouped;
  }, [bookings, range.localDates, timeZone]);

  const monthOffset =
    view === "month"
      ? (new Date(`${range.localDates[0]}T00:00:00.000Z`).getUTCDay() + 6) % 7
      : 0;

  return (
    <section className="booking-calendar-section">
      <div className="booking-calendar-toolbar">
        <div className="booking-calendar-navigation">
          <button
            aria-label={`Previous ${view}`}
            className="account-button account-button-secondary"
            onClick={() => setSelectedDate(shiftDate(selectedDate, view, -1))}
            type="button"
          >
            Previous
          </button>
          <button
            className="account-button account-button-secondary"
            onClick={() => setSelectedDate(initialLocalDate)}
            type="button"
          >
            Today
          </button>
          <button
            aria-label={`Next ${view}`}
            className="account-button account-button-secondary"
            onClick={() => setSelectedDate(shiftDate(selectedDate, view, 1))}
            type="button"
          >
            Next
          </button>
        </div>
        <div aria-label="Calendar view" className="booking-calendar-views">
          {viewOptions.map((option) => (
            <button
              aria-pressed={view === option.value}
              className={`account-button${view === option.value ? "" : " account-button-secondary"}`}
              key={option.value}
              onClick={() => setView(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="account-field booking-calendar-date">
          <span>Go to date</span>
          <input
            onChange={(event) => setSelectedDate(event.target.value)}
            type="date"
            value={selectedDate}
          />
        </label>
      </div>

      <div className="booking-calendar-heading">
        <div>
          <h2>{periodLabel(range.localDates, view)}</h2>
          <p>
            {bookings.length} {bookings.length === 1 ? "Booking" : "Bookings"}
          </p>
        </div>
        <Link className="dashboard-action-link" href="/bookings">
          Manage Bookings
        </Link>
      </div>

      {error && <p className="account-error" role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading Booking calendar...</p>
      ) : (
        <div className={`booking-calendar-grid booking-calendar-${view}`}>
          {range.localDates.map((localDate, index) => {
            const dayBookings = bookingsByDate.get(localDate) ?? [];
            return (
              <article
                className="booking-calendar-day"
                key={localDate}
                style={
                  view === "month" && index === 0
                    ? { gridColumnStart: monthOffset + 1 }
                    : undefined
                }
              >
                <div className="booking-calendar-day-heading">
                  <h3>
                    {localDateLabel(localDate, {
                      weekday: "short",
                      day: "numeric",
                      month: view === "day" ? "long" : "short",
                    })}
                  </h3>
                  <span>{dayBookings.length}</span>
                </div>
                {dayBookings.length === 0 ? (
                  <p className="booking-calendar-empty">No Bookings</p>
                ) : (
                  <ol className="booking-calendar-items">
                    {dayBookings.map((booking) => (
                      <li key={booking.id}>
                        <Link
                          className="booking-calendar-booking"
                          href={`/bookings/${booking.id}`}
                        >
                          <strong>
                            {new Intl.DateTimeFormat("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone,
                            }).format(new Date(booking.startAt))}
                            {" · "}
                            {booking.customerName}
                          </strong>
                          <span>Service: {booking.serviceName}</span>
                          <span>Staff: {booking.staffName ?? "Unassigned"}</span>
                          <span className={`booking-status booking-status-${booking.status.toLowerCase()}`}>
                            {booking.status.replaceAll("_", " ")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
