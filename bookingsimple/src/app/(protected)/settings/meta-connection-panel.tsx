"use client";

import { useEffect, useState } from "react";
import type {
  MetaConnectionStatus,
  MetaConnectionView,
  MetaManagedPageSelectionView,
  MetaOAuthStartView,
} from "@/server/meta-connection-types";

function isStatus(value: unknown): value is MetaConnectionStatus {
  return [
    "NOT_CONFIGURED",
    "NOT_CONNECTED",
    "CONNECTED",
    "ENVIRONMENT",
  ].includes(String(value));
}

function parseConnection(value: unknown): MetaConnectionView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("connection" in value) ||
    typeof value.connection !== "object" ||
    value.connection === null ||
    !("status" in value.connection) ||
    !isStatus(value.connection.status) ||
    !("canManage" in value.connection) ||
    typeof value.connection.canManage !== "boolean" ||
    ("pageId" in value.connection &&
      value.connection.pageId !== undefined &&
      typeof value.connection.pageId !== "string") ||
    ("pageName" in value.connection &&
      value.connection.pageName !== undefined &&
      typeof value.connection.pageName !== "string") ||
    ("details" in value.connection &&
      value.connection.details !== undefined &&
      typeof value.connection.details !== "string")
  ) {
    throw new Error("The server returned invalid Meta connection data.");
  }
  return value.connection as MetaConnectionView;
}

function parseOAuth(value: unknown): MetaOAuthStartView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("oauth" in value) ||
    typeof value.oauth !== "object" ||
    value.oauth === null ||
    !("url" in value.oauth) ||
    typeof value.oauth.url !== "string" ||
    !value.oauth.url.startsWith("https://www.facebook.com/")
  ) {
    throw new Error("The server returned an invalid Meta authorization URL.");
  }
  return value.oauth as MetaOAuthStartView;
}

function parseSelection(value: unknown): MetaManagedPageSelectionView {
  if (
    typeof value !== "object" ||
    value === null ||
    !("selection" in value) ||
    typeof value.selection !== "object" ||
    value.selection === null ||
    !("state" in value.selection) ||
    typeof value.selection.state !== "string" ||
    !("pages" in value.selection) ||
    !Array.isArray(value.selection.pages) ||
    !value.selection.pages.every(
      (page) =>
        typeof page === "object" &&
        page !== null &&
        "id" in page &&
        typeof page.id === "string" &&
        "name" in page &&
        typeof page.name === "string",
    )
  ) {
    throw new Error("The server returned invalid managed Page data.");
  }
  return value.selection as MetaManagedPageSelectionView;
}

async function api(
  endpoint: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "The Meta connection request could not be completed.",
    );
  }
  return result;
}

export function MetaConnectionPanel({
  metaResult,
  selectionState,
}: {
  metaResult?: "select" | "cancelled" | "error";
  selectionState?: string;
}) {
  const [connection, setConnection] = useState<MetaConnectionView | null>(null);
  const [selection, setSelection] =
    useState<MetaManagedPageSelectionView | null>(null);
  const [busy, setBusy] = useState(
    metaResult === "select" && selectionState ? "pages" : "",
  );
  const [error, setError] = useState(
    metaResult === "error"
      ? "Meta authorization could not be completed. Retry the connection."
      : "",
  );
  const [message, setMessage] = useState(
    metaResult === "cancelled" ? "Meta authorization was cancelled." : "",
  );

  useEffect(() => {
    let active = true;
    api("/api/meta/connect", "GET")
      .then((result) => {
        if (active) setConnection(parseConnection(result));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Meta connection status could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (metaResult !== "select" || !selectionState) return;
    let active = true;
    api(
      `/api/meta/connect/pages?state=${encodeURIComponent(selectionState)}`,
      "GET",
    )
      .then((result) => {
        if (active) setSelection(parseSelection(result));
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Managed Facebook Pages could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, [metaResult, selectionState]);

  async function connect() {
    if (busy) return;
    setBusy("connect");
    setError("");
    setMessage("");
    try {
      const oauth = parseOAuth(await api("/api/meta/connect", "POST"));
      window.location.assign(oauth.url);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Meta authorization could not be started.",
      );
      setBusy("");
    }
  }

  async function selectPage(pageId: string) {
    if (busy || !selection) return;
    setBusy(pageId);
    setError("");
    setMessage("");
    try {
      const next = parseConnection(
        await api("/api/meta/connect/pages", "POST", {
          state: selection.state,
          pageId,
        }),
      );
      setConnection(next);
      setSelection(null);
      setMessage(`${next.pageName ?? "Facebook Page"} connected.`);
      window.history.replaceState({}, "", "/settings");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Facebook Page could not be connected.",
      );
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    if (
      busy ||
      !window.confirm(
        "Disconnect this Facebook Page? New Messenger messages will stop entering BookSimple.",
      )
    ) {
      return;
    }
    setBusy("disconnect");
    setError("");
    setMessage("");
    try {
      setConnection(parseConnection(await api("/api/meta/connect", "DELETE")));
      setMessage("Facebook Page disconnected.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Facebook Page could not be disconnected.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="account-section">
      <h2>Facebook Messenger</h2>
      <p>
        Connect a Facebook Page you manage so its customer messages enter this
        Business&apos;s Inbox and staff can reply from BookSimple.
      </p>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-notice" role="status">
          {message}
        </p>
      )}
      {!connection ? (
        <p role="status">Loading Meta connection...</p>
      ) : (
        <>
          <dl className="account-summary">
            <div>
              <dt>Status</dt>
              <dd>
                {connection.status === "CONNECTED"
                  ? "Connected in BookSimple"
                  : connection.status === "ENVIRONMENT"
                    ? "Connected by deployment configuration"
                    : connection.status === "NOT_CONFIGURED"
                      ? "Platform configuration required"
                      : "Not connected"}
              </dd>
            </div>
            {connection.pageName && (
              <div>
                <dt>Facebook Page</dt>
                <dd>{connection.pageName}</dd>
              </div>
            )}
            {connection.pageId && (
              <div>
                <dt>Page ID</dt>
                <dd>{connection.pageId}</dd>
              </div>
            )}
          </dl>
          {connection.details && <p>{connection.details}</p>}
          {connection.canManage && connection.status !== "NOT_CONFIGURED" && (
            <div className="account-actions">
              <button
                className="account-button"
                disabled={Boolean(busy)}
                onClick={() => void connect()}
                type="button"
              >
                {busy === "connect"
                  ? "Opening Meta..."
                  : connection.status === "CONNECTED"
                    ? "Reconnect Facebook Page"
                    : "Connect Facebook Page"}
              </button>
              {connection.status === "CONNECTED" && (
                <button
                  className="account-button account-button-danger"
                  disabled={Boolean(busy)}
                  onClick={() => void disconnect()}
                  type="button"
                >
                  {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {selection && (
        <div className="conversation-match-panel">
          <h3>Select a managed Facebook Page</h3>
          <p>
            Only the selected Page will be connected to this Business
            workspace.
          </p>
          <ul className="conversation-customer-list">
            {selection.pages.map((page) => (
              <li className="conversation-customer-choice" key={page.id}>
                <div>
                  <strong>{page.name}</strong>
                  <span>Page ID: {page.id}</span>
                </div>
                <button
                  className="account-button account-button-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void selectPage(page.id)}
                  type="button"
                >
                  {busy === page.id ? "Connecting..." : "Connect this Page"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {busy === "pages" && <p role="status">Loading managed Pages...</p>}
    </section>
  );
}
