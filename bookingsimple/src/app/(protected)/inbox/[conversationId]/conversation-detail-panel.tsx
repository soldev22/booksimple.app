"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type {
  ConversationDetails,
  MessageView,
} from "@/server/conversation-types";
import type {
  CustomerDuplicateWarning,
  CustomerView,
} from "@/server/customer-types";
import {
  customerApi,
  parseCustomerPage,
  parseCustomerResult,
} from "../../customers/customer-client";
import {
  conversationApi,
  parseConversationDetails,
  parseMessageMutation,
} from "../conversation-client";

function CustomerChoice({
  customer,
  busy,
  onLink,
}: {
  customer: CustomerView;
  busy: boolean;
  onLink: (customerId: string) => void;
}) {
  return (
    <li className="conversation-customer-choice">
      <div>
        <strong>{customer.name}</strong>
        <span>{customer.email ?? customer.phone ?? "No contact details"}</span>
      </div>
      <button
        className="account-button account-button-secondary"
        disabled={busy}
        onClick={() => onLink(customer.id)}
        type="button"
      >
        Link Customer
      </button>
    </li>
  );
}

function DuplicateWarnings({
  warnings,
}: {
  warnings: CustomerDuplicateWarning[];
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="customer-warning" role="status">
      <strong>Possible duplicate Customer</strong>
      <ul>
        {warnings.map((warning) => (
          <li key={warning.id}>
            {warning.name} has the same {warning.matchingFields.join(" and ")}.
            The new record was kept separate and linked to this Conversation.
          </li>
        ))}
      </ul>
    </div>
  );
}

function deliveryLabel(message: MessageView): string {
  switch (message.deliveryStatus) {
    case "RECEIVED":
      return "Received by Email";
    case "SENT":
      return "Accepted by Postmark for delivery";
    case "PENDING":
      return "Waiting for the Email provider";
    case "FAILED":
      return "Email send failed";
    case "LOCAL_ONLY":
      return "Saved locally - not externally delivered";
  }
}

export function ConversationDetailPanel({
  initialDetails,
}: {
  initialDetails: ConversationDetails;
}) {
  const [details, setDetails] = useState(initialDetails);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerView[]>([]);
  const [warnings, setWarnings] = useState<CustomerDuplicateWarning[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { conversation, resolution } = details;

  async function refreshDetails() {
    const value = await conversationApi(
      `/api/conversations/${conversation.id}?messagePageSize=50`,
      "GET",
    );
    setDetails(parseConversationDetails(value));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("message");
    setError("");
    setMessage("");
    try {
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const result = parseMessageMutation(
        await conversationApi(
          `/api/conversations/${conversation.id}/messages`,
          "POST",
          {
            body: values.body,
            direction: "OUTBOUND",
            requestId: crypto.randomUUID(),
          },
        ),
      );
      setDetails((current) => ({
        ...current,
        conversation: result.conversation,
        messages: [...current.messages, result.message],
      }));
      form.reset();
      setMessage(
        result.message.deliveryStatus === "SENT"
          ? conversation.channel === "SMS"
            ? "SMS accepted by Twilio for delivery."
            : "Email accepted by Postmark for delivery."
          : "Reply saved locally. It was not sent to an external channel.",
      );
    } catch (failure) {
      await refreshDetails().catch(() => undefined);
      setError(
        failure instanceof Error
          ? failure.message
          : "The message could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }

  async function loadOlderMessages() {
    const token = details.messageContinuationToken;
    if (!token || busy) return;
    setBusy("older");
    setError("");
    try {
      const query = new URLSearchParams({
        messagePageSize: "50",
        messageContinuationToken: token,
      });
      const older = parseConversationDetails(
        await conversationApi(
          `/api/conversations/${conversation.id}?${query}`,
          "GET",
        ),
      );
      setDetails((current) => ({
        ...current,
        messages: [...older.messages, ...current.messages],
        messageContinuationToken: older.messageContinuationToken,
      }));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Older messages could not be loaded.",
      );
    } finally {
      setBusy("");
    }
  }

  async function linkCustomer(customerId: string) {
    if (busy) return;
    setBusy("link");
    setError("");
    setMessage("");
    try {
      await conversationApi(
        `/api/conversations/${conversation.id}/customer`,
        "POST",
        { customerId },
      );
      await refreshDetails();
      setSearchResults([]);
      setMessage("Customer linked to this Conversation.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Customer could not be linked.",
      );
    } finally {
      setBusy("");
    }
  }

  async function searchCustomers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("search");
    setError("");
    try {
      const query = new URLSearchParams({
        search: search.trim(),
        status: "active",
        pageSize: "20",
      });
      const page = parseCustomerPage(
        await customerApi(`/api/customers?${query}`, "GET"),
      );
      setSearchResults(page.customers);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Customers could not be searched.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createAndLinkCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("create");
    setError("");
    setMessage("");
    setWarnings([]);
    let createdCustomer: CustomerView | undefined;
    try {
      const result = parseCustomerResult(
        await customerApi(
          "/api/customers",
          "POST",
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      );
      createdCustomer = result.customer;
      setWarnings(result.warnings);
      await conversationApi(
        `/api/conversations/${conversation.id}/customer`,
        "POST",
        { customerId: result.customer.id },
      );
      await refreshDetails();
      setMessage(`${result.customer.name} was created and linked.`);
    } catch (failure) {
      const detail =
        failure instanceof Error
          ? failure.message
          : "The Customer could not be created.";
      setError(
        createdCustomer
          ? `${createdCustomer.name} was created, but could not be linked: ${detail}`
          : detail,
      );
    } finally {
      setBusy("");
    }
  }

  const emailPrefill =
    conversation.channel === "EMAIL" ? resolution.normalizedAddress : "";
  const phonePrefill =
    conversation.channel === "SMS" || conversation.channel === "WHATSAPP"
      ? resolution.normalizedAddress
      : "";

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-notice" role="status">{message}</p>}
      <DuplicateWarnings warnings={warnings} />

      <div className="conversation-detail-heading">
        <div>
          <h2>{conversation.contactLabel}</h2>
          <p>
            <span className="conversation-channel">{conversation.channel}</span>
            <span>{resolution.normalizedAddress}</span>
          </p>
        </div>
        <Link className="customer-action-link" href="/inbox">
          Back to Inbox
        </Link>
      </div>

      <div className="conversation-detail-layout">
        <section className="conversation-thread" aria-labelledby="messages-title">
          <div className="conversation-section-heading">
            <h2 id="messages-title">Messages</h2>
            <span>{conversation.messageCount} total</span>
          </div>
          {details.messageContinuationToken && (
            <button
              className="account-button account-button-secondary"
              disabled={Boolean(busy)}
              onClick={() => void loadOlderMessages()}
              type="button"
            >
              {busy === "older" ? "Loading..." : "Load older messages"}
            </button>
          )}
          <ol className="conversation-messages">
            {details.messages.map((item: MessageView) => (
              <li
                className={`conversation-message conversation-message-${item.direction.toLowerCase()}`}
                key={item.id}
              >
                <div className="conversation-message-meta">
                  <strong>
                    {item.direction === "INBOUND" ? "Contact" : "Business"}
                  </strong>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
                <p>{item.body}</p>
                <span className="conversation-delivery">
                  {deliveryLabel(item)}
                </span>
              </li>
            ))}
          </ol>
          <form className="conversation-reply-form" onSubmit={sendMessage}>
            <label className="account-field">
              <span>Message</span>
              <textarea
                disabled={Boolean(busy)}
                maxLength={4000}
                name="body"
                required
                rows={4}
              />
            </label>
            <p className="conversation-local-note">
              {conversation.channel === "EMAIL"
                ? "Replies use Postmark Email. Provider failures remain visible in this Conversation."
                : "Only Email is connected in this stage. This channel cannot be sent externally."}
            </p>
            <button
              className="account-button"
              disabled={Boolean(busy) || conversation.channel !== "EMAIL"}
              type="submit"
            >
              {busy === "message" ? "Sending..." : "Send Email"}
            </button>
          </form>
        </section>

        <aside className="conversation-resolution" aria-labelledby="customer-title">
          <h2 id="customer-title">Customer</h2>
          {conversation.customerId ? (
            <>
              <p className="conversation-resolved">Customer linked</p>
              <Link
                className="customer-action-link"
                href={`/customers/${conversation.customerId}`}
              >
                View Customer
              </Link>
              <Link
                className="customer-action-link"
                href={`/bookings?customerId=${conversation.customerId}&conversationId=${conversation.id}`}
              >
                Create Booking
              </Link>
            </>
          ) : (
            <>
              <p className="conversation-unresolved">Customer unresolved</p>
              {resolution.candidates.length > 0 && (
                <div className="conversation-match-panel">
                  <h3>
                    {resolution.candidates.length === 1
                      ? "Exact match found"
                      : "Choose between exact matches"}
                  </h3>
                  <p>
                    Matches use this tenant&apos;s exact normalized email or
                    phone only. Names are never used to link automatically.
                  </p>
                  <ul className="conversation-customer-list">
                    {resolution.candidates.map((customer) => (
                      <CustomerChoice
                        busy={Boolean(busy)}
                        customer={customer}
                        key={customer.id}
                        onLink={(id) => void linkCustomer(id)}
                      />
                    ))}
                  </ul>
                </div>
              )}

              <div className="conversation-resolution-section">
                <h3>Find an existing Customer</h3>
                <form className="conversation-customer-search" onSubmit={searchCustomers}>
                  <label className="account-field">
                    <span>Search by name, email or phone</span>
                    <input
                      maxLength={100}
                      onChange={(event) => setSearch(event.target.value)}
                      required
                      value={search}
                    />
                  </label>
                  <button
                    className="account-button account-button-secondary"
                    disabled={Boolean(busy)}
                    type="submit"
                  >
                    {busy === "search" ? "Searching..." : "Search Customers"}
                  </button>
                </form>
                {searchResults.length > 0 && (
                  <ul className="conversation-customer-list">
                    {searchResults.map((customer) => (
                      <CustomerChoice
                        busy={Boolean(busy)}
                        customer={customer}
                        key={customer.id}
                        onLink={(id) => void linkCustomer(id)}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div className="conversation-resolution-section">
                <h3>Create a new Customer</h3>
                <p>
                  Known channel details are prefilled. Review them before
                  creating the Customer.
                </p>
                <form className="conversation-customer-create" onSubmit={createAndLinkCustomer}>
                  <label className="account-field">
                    <span>Name</span>
                    <input
                      defaultValue={resolution.displayLabel}
                      disabled={Boolean(busy)}
                      maxLength={120}
                      name="name"
                      required
                    />
                  </label>
                  <label className="account-field">
                    <span>Email</span>
                    <input
                      defaultValue={emailPrefill}
                      disabled={Boolean(busy)}
                      maxLength={254}
                      name="email"
                      type="email"
                    />
                  </label>
                  <label className="account-field">
                    <span>Phone</span>
                    <input
                      defaultValue={phonePrefill}
                      disabled={Boolean(busy)}
                      maxLength={40}
                      name="phone"
                      type="tel"
                    />
                  </label>
                  <button className="account-button" disabled={Boolean(busy)} type="submit">
                    {busy === "create" ? "Creating..." : "Create and link Customer"}
                  </button>
                </form>
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
