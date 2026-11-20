import Link from "next/link";
import type { ReactNode } from "react";
import { PageFooter } from "./page-chrome";

const legalLinks = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of service" },
  { href: "/data-deletion", label: "Data deletion" },
] as const;

export function LegalPage({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-page">
      <header className="account-page-header">
        <Link className="account-brand" href="/">BookSimple</Link>
        <Link className="dashboard-action-link" href="/login">Sign in</Link>
      </header>
      <main className="legal-shell" id="main-content">
        <article className="legal-card">
          <p className="eyebrow">BOOKSIMPLE LEGAL</p>
          <h1>{title}</h1>
          <p className="legal-effective-date">Effective 20 November 2026</p>
          <p className="legal-summary">{summary}</p>
          <nav aria-label="Legal information" className="legal-navigation">
            {legalLinks.map((link) => (
              <Link className="dashboard-action-link" href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="legal-content">{children}</div>
        </article>
      </main>
      <PageFooter />
    </div>
  );
}
