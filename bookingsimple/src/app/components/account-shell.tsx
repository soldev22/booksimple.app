import Link from "next/link";
import type { ReactNode } from "react";
import type { Viewer } from "@/server/auth-types";
import { HeaderUserActions, PageFooter } from "./page-chrome";

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
  return (
    <div className="account-page">
      <header className="account-page-header">
        <Link className="account-brand" href="/">BookSimple</Link>
        {viewer && <HeaderUserActions viewer={viewer} />}
      </header>
      <main className={`account-shell${wide ? " account-shell-wide" : ""}`}>
        <section className="account-card" aria-labelledby="account-title">
          <p className="eyebrow">YOUR BUSINESS WORKSPACE</p>
          <h1 id="account-title">{title}</h1>
          <p className="account-description">{description}</p>
          {children}
        </section>
      </main>
      <PageFooter />
    </div>
  );
}
