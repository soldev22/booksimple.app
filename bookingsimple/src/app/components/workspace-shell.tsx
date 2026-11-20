"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type IconName =
  | "dashboard"
  | "inbox"
  | "customers"
  | "bookings"
  | "services"
  | "settings"
  | "users"
  | "administration"
  | "account";

type NavigationItem = {
  label: string;
  icon: IconName;
  href: string;
  match: (pathname: string) => boolean;
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
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
    users: (
      <>
        <circle cx="8" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M2.5 20v-1.5a5.5 5.5 0 0 1 11 0V20h-11ZM14 15a4.5 4.5 0 0 1 7.5 3.5V20H16" />
      </>
    ),
    administration: (
      <>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M8 10h2m4 0h2m-8 4h2m4 0h2M3 21h18m-11 0v-4h4v4" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
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

function startsWithRoute(route: string) {
  return (pathname: string) =>
    pathname === route || pathname.startsWith(`${route}/`);
}

function NavigationSection({
  items,
  label,
  onNavigate,
  pathname,
}: {
  items: NavigationItem[];
  label: string;
  onNavigate: () => void;
  pathname: string;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="workspace-label">{label}</div>
      <nav aria-label={`${label.toLowerCase()} navigation`}>
        <ul className="navigation-list">
          {items.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`navigation-link${active ? " navigation-link-active" : ""}`}
                  href={item.href}
                  onClick={onNavigate}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

export function WorkspaceShell({
  businessName,
  canManageCompanyUsers,
  children,
  footer,
  hasTenant,
  platformAdmin,
  userActions,
}: {
  businessName?: string;
  canManageCompanyUsers: boolean;
  children: ReactNode;
  footer: ReactNode;
  hasTenant: boolean;
  platformAdmin: boolean;
  userActions: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const primaryItems: NavigationItem[] =
    hasTenant || platformAdmin
      ? [
        {
          label: "Dashboard",
          icon: "dashboard",
          href: "/",
          match: (path) => path === "/",
        },
        ...(hasTenant
          ? [
              {
                label: "Inbox",
                icon: "inbox" as const,
                href: "/inbox",
                match: startsWithRoute("/inbox"),
              },
              {
                label: "Customers",
                icon: "customers" as const,
                href: "/customers",
                match: startsWithRoute("/customers"),
              },
              {
                label: "Bookings",
                icon: "bookings" as const,
                href: "/bookings",
                match: startsWithRoute("/bookings"),
              },
              ...(canManageCompanyUsers
                ? [
                    {
                      label: "Services",
                      icon: "services" as const,
                      href: "/services",
                      match: startsWithRoute("/services"),
                    },
                  ]
                : []),
            ]
          : []),
      ]
      : [];
  const managementItems: NavigationItem[] = [
    ...(hasTenant
      ? [
          {
            label: "Business settings",
            icon: "settings" as const,
            href: "/settings",
            match: startsWithRoute("/settings"),
          },
        ]
      : []),
    ...(canManageCompanyUsers || platformAdmin
      ? [
          {
            label: platformAdmin ? "Users and companies" : "Company users",
            icon: "users" as const,
            href: "/admin/users",
            match: (path: string) =>
              path === "/admin/users" || path.startsWith("/admin/users/"),
          },
        ]
      : []),
    ...(platformAdmin
      ? [
          {
            label: "Platform administration",
            icon: "administration" as const,
            href: "/admin",
            match: (path: string) => path === "/admin",
          },
        ]
      : []),
    {
      label: "My account",
      icon: "account",
      href: "/account",
      match: startsWithRoute("/account"),
    },
  ];
  const allItems = [...primaryItems, ...managementItems];
  const currentPage =
    allItems.find((item) => item.match(pathname))?.label ?? "Workspace";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside
        className={`sidebar${menuOpen ? " sidebar-open" : ""}`}
        id="workspace-navigation"
      >
        <Link
          aria-label="BookSimple dashboard"
          className="brand"
          href={hasTenant ? "/" : "/account"}
          onClick={() => setMenuOpen(false)}
        >
          <span aria-hidden="true" className="brand-mark">
            b
          </span>
          <span className="brand-name">BookSimple</span>
        </Link>

        <NavigationSection
          items={primaryItems}
          label="WORKSPACE"
          onNavigate={() => setMenuOpen(false)}
          pathname={pathname}
        />
        <NavigationSection
          items={managementItems}
          label="MANAGE"
          onNavigate={() => setMenuOpen(false)}
          pathname={pathname}
        />

        <div className="sidebar-footer">
          <div aria-hidden="true" className="workspace-avatar">
            {(businessName ?? "A").charAt(0).toUpperCase()}
          </div>
          <div className="workspace-details">
            <span className="workspace-name">
              {businessName ?? "Account workspace"}
            </span>
            <span className="workspace-type">
              {hasTenant ? "Business account" : "User account"}
            </span>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <button
          aria-label="Close navigation menu"
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      )}

      <div className="main-column">
        <header className="topbar">
          <button
            aria-controls="workspace-navigation"
            aria-expanded={menuOpen}
            aria-label="Open navigation menu"
            className="workspace-menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div aria-label="Current page" className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true" className="breadcrumb-divider">
              /
            </span>
            <span className="breadcrumb-current">{currentPage}</span>
          </div>
          {userActions}
        </header>

        <main className="workspace-main" id="main-content">
          {children}
        </main>
        {footer}
      </div>
    </div>
  );
}
