"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { submitAccountAction } from "@/app/components/account-form";

export function ApplicationResubmissionForm({
  businessName,
}: {
  businessName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await submitAccountAction(
        "/api/auth/resubmit-application",
        values,
      );
      setMessage(result.message ?? "Your application was resubmitted.");
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The application could not be resubmitted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label className="account-field">
        <span>Business name</span>
        <input
          defaultValue={businessName}
          disabled={busy}
          maxLength={120}
          minLength={2}
          name="businessName"
          required
        />
      </label>
      <p>
        Correct the business name if needed, then send the application back for
        platform review.
      </p>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <button className="account-button" disabled={busy} type="submit">
        {busy ? "Resubmitting..." : "Resubmit application"}
      </button>
    </form>
  );
}
