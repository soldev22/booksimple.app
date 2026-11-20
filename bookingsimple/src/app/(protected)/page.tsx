import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import {
  getOperationalDashboard,
  type DashboardBookingItem,
  type DashboardConversationItem,
  type DashboardReminderItem,
} from "@/server/dashboard-service";
import { formatMinorAmount } from "@/server/money";

function formatDashboardDate(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function BookingItems({
  bookings,
  emptyMessage,
  timeZone,
  showDeposit = false,
}: {
  bookings: DashboardBookingItem[];
  emptyMessage: string;
  timeZone: string;
  showDeposit?: boolean;
}) {
  if (bookings.length === 0) {
    return <p className="dashboard-empty">{emptyMessage}</p>;
  }
  return (
    <ul className="dashboard-item-list">
      {bookings.map((booking) => (
        <li className="dashboard-item" key={booking.id}>
          <div>
            <strong>{booking.customerName}</strong>
            <span>{booking.serviceName}</span>
            <span>{formatDashboardDate(booking.startAt, timeZone)}</span>
          </div>
          <div className="dashboard-item-actions">
            {showDeposit && (
              <span className="dashboard-item-note">
                {formatMinorAmount(
                  booking.depositAmountMinor,
                  booking.currency,
                )}{" "}
                due
              </span>
            )}
            <Link
              className="dashboard-action-link"
              href={`/bookings/${booking.id}`}
            >
              View Booking
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConversationItems({
  conversations,
  timeZone,
}: {
  conversations: DashboardConversationItem[];
  timeZone: string;
}) {
  if (conversations.length === 0) {
    return <p className="dashboard-empty">No customers are waiting for a reply.</p>;
  }
  return (
    <ul className="dashboard-item-list">
      {conversations.map((conversation) => (
        <li className="dashboard-item" key={conversation.id}>
          <div>
            <strong>{conversation.contactLabel}</strong>
            <span>
              {conversation.channel} ·{" "}
              {formatDashboardDate(conversation.lastMessageAt, timeZone)}
            </span>
            <span>{conversation.lastMessagePreview}</span>
          </div>
          <Link
            className="dashboard-action-link"
            href={`/inbox/${conversation.id}`}
          >
            Reply
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReminderItems({
  reminders,
  timeZone,
}: {
  reminders: DashboardReminderItem[];
  timeZone: string;
}) {
  if (reminders.length === 0) {
    return <p className="dashboard-empty">No reminder failures need attention.</p>;
  }
  return (
    <ul className="dashboard-item-list">
      {reminders.map((reminder) => (
        <li className="dashboard-item" key={reminder.id}>
          <div>
            <strong>{reminder.customerName}</strong>
            <span>
              {reminder.serviceName} · {reminder.channel}
            </span>
            <span>
              Failed {formatDashboardDate(reminder.scheduledFor, timeZone)} ·{" "}
              {reminder.attemptCount}{" "}
              {reminder.attemptCount === 1 ? "attempt" : "attempts"}
            </span>
          </div>
          <Link
            className="dashboard-action-link"
            href={`/bookings/${reminder.bookingId}`}
          >
            Review
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  const { tenant } = viewer;
  const operational = await getOperationalDashboard(tenant);
  const dashboardMetrics = [
    {
      label: "Today's bookings",
      value: operational.todayCount,
      detail: "Scheduled today, excluding cancellations",
    },
    {
      label: "Upcoming bookings",
      value: operational.upcomingCount,
      detail: "Future active Bookings",
    },
    {
      label: "Customers awaiting reply",
      value: operational.attentionCount,
      detail: "Conversations where the customer spoke last",
    },
    {
      label: "Deposits awaiting payment",
      value: operational.awaitingDepositCount,
      detail: "Bookings currently awaiting their deposit",
    },
    {
      label: "Reminder failures",
      value: operational.failedReminderCount,
      detail: "Due reminders with a failed delivery attempt",
    },
  ];
  return (
    <div className="dashboard">
          <div className="page-heading">
            <div>
              <p className="eyebrow">OVERVIEW</p>
              <h1>Welcome to your workspace</h1>
              <p className="page-description">
                A clear view of {tenant.businessName}, all in one place.
              </p>
            </div>
            <div className="date-label">
              <span aria-hidden="true" className="calendar-dot" />
              {new Intl.DateTimeFormat("en-GB", {
                dateStyle: "full",
                timeZone: operational.timeZone,
              }).format(new Date(operational.generatedAt))}
            </div>
          </div>

          <section aria-label="Workspace overview" className="metrics-grid">
            {dashboardMetrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-card-heading">
                  <h2>{metric.label}</h2>
                  <span aria-hidden="true" className="metric-indicator">
                    —
                  </span>
                </div>
                <p className="metric-value">{metric.value}</p>
                <p className="metric-detail">{metric.detail}</p>
              </article>
            ))}
          </section>

          <section
            aria-label="Daily operational overview"
            className="dashboard-sections"
          >
            <article className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <p className="eyebrow">TODAY</p>
                  <h2>Today&apos;s Bookings</h2>
                </div>
                <Link className="dashboard-action-link" href="/bookings">
                  All Bookings
                </Link>
              </div>
              <BookingItems
                bookings={operational.todayBookings}
                emptyMessage="No Bookings are scheduled today."
                timeZone={operational.timeZone}
              />
            </article>

            <article className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <p className="eyebrow">COMING UP</p>
                  <h2>Upcoming Bookings</h2>
                </div>
              </div>
              <BookingItems
                bookings={operational.upcomingBookings}
                emptyMessage="No upcoming Bookings."
                timeZone={operational.timeZone}
              />
            </article>

            <article className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <p className="eyebrow">INBOX</p>
                  <h2>Customers awaiting reply</h2>
                </div>
                <Link className="dashboard-action-link" href="/inbox">
                  Open Inbox
                </Link>
              </div>
              <ConversationItems
                conversations={operational.attentionConversations}
                timeZone={operational.timeZone}
              />
            </article>

            <article className="dashboard-panel">
              <div className="dashboard-panel-heading">
                <div>
                  <p className="eyebrow">PAYMENTS</p>
                  <h2>Deposits awaiting payment</h2>
                </div>
              </div>
              <BookingItems
                bookings={operational.awaitingDepositBookings}
                emptyMessage="No Booking deposits are awaiting payment."
                showDeposit
                timeZone={operational.timeZone}
              />
            </article>

            <article className="dashboard-panel dashboard-panel-wide">
              <div className="dashboard-panel-heading">
                <div>
                  <p className="eyebrow">REMINDERS</p>
                  <h2>Delivery failures</h2>
                </div>
              </div>
              <ReminderItems
                reminders={operational.failedReminders}
                timeZone={operational.timeZone}
              />
            </article>
          </section>
    </div>
  );
}
