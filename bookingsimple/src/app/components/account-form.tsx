"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

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
}: {
  endpoint: string;
  fields: FormField[];
  label: string;
  children?: ReactNode;
  onSuccess?: (result: ActionResult) => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
            defaultValue={field.defaultValue}
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
