"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitAccountAction } from "./account-form";

export function HeaderLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await submitAccountAction("/api/auth/logout", {});
      if (
        !result.redirect ||
        !result.redirect.startsWith("/") ||
        result.redirect.startsWith("//") ||
        result.redirect.includes("\\")
      ) {
        throw new Error("The server returned an invalid logout response.");
      }
      router.push(result.redirect);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to sign out.",
      );
      setBusy(false);
    }
  }

  return (
    <span className="header-logout-control">
      {error && <span className="header-logout-error" role="alert">{error}</span>}
      <button
        className="header-logout-button"
        disabled={busy}
        onClick={logout}
        type="button"
      >
        {busy ? "Logging out..." : "Log out"}
      </button>
    </span>
  );
}
