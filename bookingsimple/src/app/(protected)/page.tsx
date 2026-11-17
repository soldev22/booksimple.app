import Link from "next/link";
import { redirect } from "next/navigation";
import { HeaderUserActions, PageFooter } from "@/app/components/page-chrome";
import { getViewer } from "@/server/auth";

type IconName =
  | "dashboard"
  | "inbox"
  | "customers"
  | "bookings"
  | "services"
  | "settings";

type NavigationItem = {
  label: string;
  icon: IconName;
  active?: boolean;
  href?: string;
};

const navigationItems: NavigationItem[] = [
  { label: "Dashboard", icon: "dashboard", active: true },
  { label: "Inbox", icon: "inbox" },
  { label: "Customers", icon: "customers", href: "/customers" },
  { label: "Bookings", icon: "bookings" },
  { label: "Services", icon: "services" },
  { label: "Settings", icon: "settings", href: "/settings" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 4h16l1 11h-5l-2 3h-4l-2-3H3L4 4Z" />
        <path d="M4 4 3 15m17-11 1 11" />
      </>
    ),
    customers: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20v-1.5a6 6 0 0 1 12 0V20H3Z" />
        <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14a5 5 0 0 1 3 4.5V20h-3" />
      </>
    ),
    bookings: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 10h18m-13 5 2 2 4-4" />
      </>
    ),
    services: (
      <>
        <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
        <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.3 1-1.3 2.3-1.6-.6a7.8 7.8 0 0 1-1.5.9l-.3 1.7h-2.7l-.3-1.7a7.8 7.8 0 0 1-1.5-.9l-1.6.6-1.3-2.3 1.3-1a7 7 0 0 1 0-1.8l-1.3-1 1.3-2.3 1.6.6a7.8 7.8 0 0 1 1.5-.9l.3-1.7h2.7l.3 1.7a7.8 7.8 0 0 1 1.5.9l1.6-.6 1.3 2.3-1.3 1a7 7 0 0 1-.1 1.7Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function Navigation() {
  return (
    <nav aria-label="Main navigation">
      <ul className="navigation-list">
        {navigationItems.map((item) => (
          <li key={item.label}>
            {item.active || item.href ? (
              <Link
                aria-current={item.active ? "page" : undefined}
                className={`navigation-link${item.active ? " navigation-link-active" : ""}`}
                href={item.href ?? "/"}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <button
                aria-label={`${item.label}, coming in a later stage`}
                className="navigation-link navigation-link-placeholder"
                disabled
                type="button"
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

const dashboardMetrics = [
  { label: "Today's bookings", detail: "Booking tools are coming later" },
  { label: "Open conversations", detail: "Inbox tools are coming later" },
  { label: "Customers", detail: "Manage customer records" },
  { label: "Services", detail: "Service tools are coming later" },
];

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  const { tenant } = viewer;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="sidebar">
        <Link aria-label="BookSimple home" className="brand" href="/">
          <span aria-hidden="true" className="brand-mark">
            b
          </span>
          <span className="brand-name">BookSimple</span>
        </Link>

        <div className="workspace-label">WORKSPACE</div>
        <Navigation />

        <div className="sidebar-footer">
          <div aria-hidden="true" className="workspace-avatar">
            {tenant.businessName.charAt(0).toUpperCase()}
          </div>
          <div className="workspace-details">
            <span className="workspace-name">{tenant.businessName}</span>
            <span className="workspace-type">Business account</span>
          </div>
          <span aria-hidden="true" className="workspace-menu">
            ···
          </span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <Link
            aria-label="BookSimple home"
            className="brand mobile-brand"
            href="/"
          >
            <span aria-hidden="true" className="brand-mark">
              b
            </span>
            <span className="brand-name">BookSimple</span>
          </Link>
          <div aria-label="Current page" className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true" className="breadcrumb-divider">
              /
            </span>
            <span className="breadcrumb-current">Dashboard</span>
          </div>
          <HeaderUserActions viewer={viewer} />
        </header>

        <div className="mobile-navigation">
          <Navigation />
        </div>

        <main className="dashboard" id="main-content">
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
              {tenant.businessName}
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
                <p className="metric-value">—</p>
                <p className="metric-detail">{metric.detail}</p>
              </article>
            ))}
          </section>

          <section aria-labelledby="welcome-card-title" className="welcome-card">
            <div className="welcome-content">
              <span className="welcome-kicker">YOUR BUSINESS, SIMPLIFIED</span>
              <h2 id="welcome-card-title">Your workspace is ready to grow.</h2>
              <p>
                The foundation is in place. As your tools are added, this
                dashboard will bring your day-to-day work together.
              </p>
              <div className="welcome-note">
                <span aria-hidden="true" className="welcome-note-icon">
                  ✓
                </span>
                <span>Simple tools for your everyday work</span>
              </div>
            </div>
            <div aria-hidden="true" className="welcome-illustration">
              <div className="illustration-orbit illustration-orbit-outer" />
              <div className="illustration-orbit illustration-orbit-inner" />
              <div className="illustration-card illustration-card-back" />
              <div className="illustration-card illustration-card-front">
                <span className="illustration-check">✓</span>
                <span className="illustration-line illustration-line-long" />
                <span className="illustration-line illustration-line-short" />
              </div>
              <span className="illustration-spark illustration-spark-one">✦</span>
              <span className="illustration-spark illustration-spark-two">✦</span>
            </div>
          </section>

          <section aria-labelledby="getting-started-title" className="next-section">
            <div className="section-heading">
              <div>
                <h2 id="getting-started-title">Your workspace at a glance</h2>
                <p>These areas will become available as the platform grows.</p>
              </div>
              <span className="section-tag">IN DEVELOPMENT</span>
            </div>
            <div className="area-list">
              {navigationItems.slice(1, 5).map((item, index) => (
                <div className="area-item" key={item.label}>
                  <span className={`area-icon area-icon-${index + 1}`}>
                    <Icon name={item.icon} />
                  </span>
                  <span className="area-name">{item.label}</span>
                  <span className="area-status">
                    {item.href ? "Available" : "Coming later"}
                  </span>
                  <span aria-hidden="true" className="area-arrow">
                    →
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>

        <PageFooter />
      </div>
    </div>
  );
}
