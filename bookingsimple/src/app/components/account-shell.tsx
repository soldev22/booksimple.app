import Link from "next/link";
import type { ReactNode } from "react";

export function AccountShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className={`account-shell${wide ? " account-shell-wide" : ""}`}>
      <Link className="account-brand" href="/">BookSimple</Link>
      <section className="account-card" aria-labelledby="account-title">
        <p className="eyebrow">YOUR BUSINESS WORKSPACE</p>
        <h1 id="account-title">{title}</h1>
        <p className="account-description">{description}</p>
        {children}
      </section>
    </main>
  );
}
