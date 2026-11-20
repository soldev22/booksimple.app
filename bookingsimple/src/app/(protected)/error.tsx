"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ProtectedRouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "protected-route-render-failed",
        digest: error.digest ?? "unavailable",
      }),
    );
  }, [error.digest]);

  return (
    <main className="account-shell">
      <section aria-labelledby="protected-error-title" className="account-card">
        <p className="eyebrow">TEMPORARY PROBLEM</p>
        <h1 id="protected-error-title">We couldn&apos;t load this page</h1>
        <p className="account-description">
          Your access has not changed. Try loading the page again, or return to
          the Dashboard.
        </p>
        <div className="account-actions">
          <button className="account-button" onClick={retry} type="button">
            Try again
          </button>
          <Link className="account-button account-button-secondary" href="/">
            Back to Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
