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

function PlatformAdminDashboard({ name }: { name: string }) {
  const destinations = [
    {
      title: "Users and companies",
      description:
        "Manage company users, cross-company accounts and company records.",
      href: "/admin/users",
      action: "Open directory",
    },
    {
      title: "Company applications",
      description:
        "Review pending applications and manage approval decisions.",
      href: "/admin/users#applications",
      action: "Review applications",
    },
    {
      title: "Administration overview",
      description: "Open the platform administration landing area.",
      href: "/admin",
      action: "Open administration",
    },
    {
      title: "My account",
      description: "Review your signed-in account and available roles.",
      href: "/account",
      action: "Open account",
    },
  ];

  return (
    <div className="dashboard">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM OVERVIEW</p>
          <h1>Platform dashboard</h1>
          <p className="page-description">
            Welcome, {name}. Choose an administration area from the left menu
            or the shortcuts below.
          </p>
        </div>
      </div>
      <section
        aria-label="Platform administration destinations"
        className="dashboard-sections"
      >
        {destinations.map((destination) => (
          <article className="dashboard-panel" key={destination.href}>
            <div className="dashboard-panel-heading">
              <div>
                <p className="eyebrow">ADMINISTRATION</p>
                <h2>{destination.title}</h2>
              </div>
            </div>
            <p className="dashboard-empty">{destination.description}</p>
            <Link className="dashboard-action-link" href={destination.href}>
              {destination.action}
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) {
    if (viewer.user.platformAdmin) {
      return <PlatformAdminDashboard name={viewer.user.name} />;
    }
    redirect("/account");
  }
  const { tenant } = viewer;
  const operational = await getOperationalDashboard(tenant);
  const dashboardMetrics: {
    label: string;
    value: number;
    detail: string;
    href?: string;
  }[] = [
    {
      label: "Today's bookings",
      value: operational.todayCount,
      detail: "Scheduled today, excluding cancellations",
      href: "/bookings/calendar",
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
            {dashboardMetrics.map((metric) => {
              const content = (
                <>
                  <div className="metric-card-heading">
                    <h2>{metric.label}</h2>
                    <span aria-hidden="true" className="metric-indicator">
                      —
                    </span>
                  </div>
                  <p className="metric-value">{metric.value}</p>
                  <p className="metric-detail">{metric.detail}</p>
                </>
              );
              return metric.href ? (
                <Link
                  aria-label={`Open ${metric.label}`}
                  className="metric-card metric-card-link"
                  href={metric.href}
                  key={metric.label}
                >
                  {content}
                </Link>
              ) : (
                <article className="metric-card" key={metric.label}>
                  {content}
                </article>
              );
            })}
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
                <Link
                  className="dashboard-action-link"
                  href="/bookings/calendar"
                >
                  Open Calendar
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
