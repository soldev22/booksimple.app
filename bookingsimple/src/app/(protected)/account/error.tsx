"use client";

import Link from "next/link";

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <main className="account-shell">
      <section className="account-card">
        <h1>Account service unavailable</h1>
        <p>We couldn&apos;t load your account. Please try again. No access has been granted.</p>
        <button className="account-button" onClick={reset}>Try again</button>
        <p className="account-links"><Link href="/">Back to home</Link></p>
      </section>
    </main>
  );
}
