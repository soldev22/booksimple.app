"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const LOGIN_EMAIL_STORAGE_KEY = "booksimple-login-email";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "hidden";
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  help?: string;
  readOnly?: boolean;
};

export type ActionResult = {
  message?: string;
  redirect?: string;
  secret?: string;
  uri?: string;
  backupCodes?: string[];
};

function isResponseObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function submitAccountAction(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!isResponseObject(data)) {
    throw new Error("The server returned an unexpected response.");
  }
  if (!response.ok) {
    throw new Error(
      "error" in data && typeof data.error === "string"
        ? data.error
        : "The request could not be completed.",
    );
  }
  const result: ActionResult = {};
  for (const key of ["message", "redirect", "secret", "uri"] as const) {
    if (key in data) {
      if (typeof data[key] !== "string") {
        throw new Error("The server returned an unexpected response.");
      }
      result[key] = data[key];
    }
  }
  if ("backupCodes" in data) {
    if (!Array.isArray(data.backupCodes) || !data.backupCodes.every((code) => typeof code === "string")) {
      throw new Error("The server returned invalid recovery codes.");
    }
    result.backupCodes = data.backupCodes;
  }
  return result;
}

export function AccountForm({
  endpoint,
  fields,
  label,
  children,
  onSuccess,
  rememberEmailForLogin = false,
  restoreEmailForLogin = false,
}: {
  endpoint: string;
  fields: FormField[];
  label: string;
  children?: ReactNode;
  onSuccess?: (result: ActionResult) => void;
  rememberEmailForLogin?: boolean;
  restoreEmailForLogin?: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restoredEmail, setRestoredEmail] = useState("");

  useEffect(() => {
    if (!restoreEmailForLogin) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        const email = window.sessionStorage.getItem(LOGIN_EMAIL_STORAGE_KEY);
        if (email) setRestoredEmail(email);
        window.sessionStorage.removeItem(LOGIN_EMAIL_STORAGE_KEY);
      } catch (failure) {
        console.warn("Unable to restore the registration email.", failure);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [restoreEmailForLogin]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const result = await submitAccountAction(endpoint, values);
      setMessage(result.message ?? "Request completed.");
      if (rememberEmailForLogin && typeof values.email === "string") {
        try {
          window.sessionStorage.setItem(
            LOGIN_EMAIL_STORAGE_KEY,
            values.email,
          );
        } catch (failure) {
          console.warn("Unable to preserve the registration email.", failure);
        }
      }
      if (onSuccess) {
        onSuccess(result);
      } else if (result.redirect) {
        if (
          !result.redirect.startsWith("/") ||
          result.redirect.startsWith("//") ||
          result.redirect.includes("\\")
        ) {
          throw new Error("The server returned an invalid redirect.");
        }
        router.push(result.redirect);
        router.refresh();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to contact the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      {fields.map((field) => field.type === "hidden" ? (
        <input key={field.name} type="hidden" name={field.name} value={field.defaultValue ?? ""} />
      ) : (
        <div className="account-field" key={field.name}>
          <label htmlFor={`${formId}-${field.name}`}>{field.label}</label>
          <input
            id={`${formId}-${field.name}`}
            name={field.name}
            type={field.type ?? "text"}
            autoComplete={field.autoComplete}
            required={field.required ?? true}
            minLength={field.minLength}
            maxLength={field.maxLength}
            {...(
              restoreEmailForLogin &&
              field.name === "email" &&
              field.defaultValue === undefined
                ? {
                    value: restoredEmail,
                    onChange: (event) => setRestoredEmail(event.target.value),
                  }
                : { defaultValue: field.defaultValue }
            )}
            readOnly={field.readOnly}
            disabled={busy}
            aria-describedby={field.help ? `${formId}-${field.name}-help` : undefined}
          />
          {field.help && <small id={`${formId}-${field.name}-help`}>{field.help}</small>}
        </div>
      ))}
      {children}
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <button className="account-button" disabled={busy} type="submit">
        {busy ? "Please wait..." : label}
      </button>
    </form>
  );
}
