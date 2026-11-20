import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@/server/auth-types";
import { PageFooter } from "./page-chrome";

export function AccountShell({
  title,
  description,
  children,
  wide = false,
  viewer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  viewer?: Viewer;
}) {
  const content = (
    <section className="account-card" aria-labelledby="account-title">
      <p className="eyebrow">YOUR BUSINESS WORKSPACE</p>
      <h1 id="account-title">{title}</h1>
      <p className="account-description">{description}</p>
      {children}
    </section>
  );

  if (viewer) {
    return (
      <div className={`account-shell${wide ? " account-shell-wide" : ""}`}>
        {content}
      </div>
    );
  }

  return (
    <div className="account-page">
      <header className="account-page-header">
        <Link className="account-brand" href="/">BookSimple</Link>
      </header>
      <main className={`account-shell${wide ? " account-shell-wide" : ""}`}>
        {content}
      </main>
      <PageFooter />
    </div>
  );
}
