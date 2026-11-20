"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type {
  CommunicationChannel,
  ConversationView,
} from "@/server/conversation-types";
import {
  conversationApi,
  parseConversationArchiveMutation,
  parseConversationMutation,
  parseConversationPage,
} from "./conversation-client";

function contactPlaceholder(channel: CommunicationChannel): string {
  if (channel === "EMAIL") return "customer@example.com";
  if (channel === "SMS" || channel === "WHATSAPP") return "+44 7700 900123";
  if (channel === "FACEBOOK") return "Facebook conversations start from Page messages";
  return "Provider-neutral contact ID";
}

export function InboxPanel({
  canManageArchivedConversations,
}: {
  canManageArchivedConversations: boolean;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [archive, setArchive] = useState<"active" | "archived">("active");
  const [channel, setChannel] =
    useState<CommunicationChannel>("WHATSAPP");
  const [continuationToken, setContinuationToken] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      pageSize: "50",
      ...(submittedSearch ? { search: submittedSearch } : {}),
      archive,
    });
    conversationApi(`/api/conversations?${query}`, "GET")
      .then((value) => {
        if (!active) return;
        const page = parseConversationPage(value);
        setConversations(page.conversations);
        setContinuationToken(page.continuationToken);
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Conversations could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archive, submittedSearch]);

  function searchConversations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    setSubmittedSearch(search.trim());
  }

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const result = parseConversationMutation(
        await conversationApi("/api/conversations", "POST", {
          channel: values.channel,
          contactValue: values.contactValue,
          contactLabel: values.contactLabel,
          initialMessage: values.initialMessage,
          direction: values.direction,
        }),
      );
      router.push(`/inbox/${result.conversation.id}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Conversation could not be created.",
      );
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!continuationToken || loading) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        pageSize: "50",
        continuationToken,
        ...(submittedSearch ? { search: submittedSearch } : {}),
        archive,
      });
      const page = parseConversationPage(
        await conversationApi(`/api/conversations?${query}`, "GET"),
      );
      setConversations((current) => [...current, ...page.conversations]);
      setContinuationToken(page.continuationToken);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "More Conversations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function setConversationArchived(
    conversation: ConversationView,
    archived: boolean,
  ) {
    if (busy) return;
    const confirmed = window.confirm(
      archived
        ? `Delete the Conversation with ${conversation.contactLabel}? Messages will be retained and a new incoming message will restore it automatically.`
        : `Restore the Conversation with ${conversation.contactLabel}?`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      parseConversationArchiveMutation(
        await conversationApi(
          `/api/conversations/${conversation.id}/archive`,
          "POST",
          { archived },
        ),
      );
      setConversations((current) =>
        current.filter((item) => item.id !== conversation.id),
      );
      setMessage(
        archived ? "Conversation deleted." : "Conversation restored.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The Conversation archive state could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-success" role="status">{message}</p>}

      <section className="account-section">
        <h2>Start a Conversation</h2>
        <p>
          Outgoing Email, SMS, WhatsApp and Facebook replies use connected
          providers. WhatsApp and Facebook free-form replies require an active
          messaging window.
        </p>
        <form className="conversation-create-form" onSubmit={createConversation}>
          <label className="account-field">
            <span>Channel</span>
            <select
              disabled={busy}
              name="channel"
              onChange={(event) =>
                setChannel(event.target.value as CommunicationChannel)
              }
              value={channel}
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option disabled value="FACEBOOK">
                Facebook / Meta (starts from a Page message)
              </option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">Email</option>
            </select>
          </label>
          <label className="account-field">
            <span>Contact address</span>
            <input
              disabled={busy}
              maxLength={254}
              name="contactValue"
              placeholder={contactPlaceholder(channel)}
              required
              type={channel === "SMS" || channel === "WHATSAPP" ? "tel" : "text"}
            />
            {(channel === "SMS" || channel === "WHATSAPP") && (
              <small>
                Use international format with a leading + and country code,
                for example +44 7700 900123.
              </small>
            )}
          </label>
          <label className="account-field">
            <span>Display name (optional)</span>
            <input
              disabled={busy}
              maxLength={120}
              name="contactLabel"
              placeholder="How this contact appears in the inbox"
            />
          </label>
          <label className="account-field">
            <span>First message</span>
            <select disabled={busy} name="direction" defaultValue="OUTBOUND">
              <option value="OUTBOUND">Send outgoing message</option>
              <option value="INBOUND">Simulate an incoming message</option>
            </select>
          </label>
          <label className="account-field conversation-message-field">
            <span>Message</span>
            <textarea
              disabled={busy}
              maxLength={4000}
              name="initialMessage"
              required
              rows={4}
            />
          </label>
          <button className="account-button" disabled={busy} type="submit">
            {busy ? "Opening..." : "Open Conversation"}
          </button>
        </form>
      </section>

      <section className="account-section">
        <h2>Conversations</h2>
        {canManageArchivedConversations && (
          <label className="account-field">
            <span>Visibility</span>
            <select
              disabled={loading || busy}
              onChange={(event) => {
                setLoading(true);
                setConversations([]);
                setContinuationToken(undefined);
                setArchive(event.target.value as "active" | "archived");
              }}
              value={archive}
            >
              <option value="active">Current Conversations</option>
              <option value="archived">Deleted Conversations</option>
            </select>
          </label>
        )}
        <form className="conversation-search" onSubmit={searchConversations}>
          <label className="account-field">
            <span>Search</span>
            <input
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Contact, channel or recent message"
              value={search}
            />
          </label>
          <button className="account-button" type="submit">Search</button>
        </form>

        {loading && conversations.length === 0 ? (
          <p role="status">Loading Conversations...</p>
        ) : conversations.length === 0 ? (
          <p>No Conversations match this view.</p>
        ) : (
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <article className="conversation-list-item" key={conversation.id}>
                <div className="conversation-list-heading">
                  <div>
                    <h3>{conversation.contactLabel}</h3>
                    <span className="conversation-channel">
                      {conversation.channel}
                    </span>
                    {!conversation.customerId && (
                      <span className="conversation-unresolved">
                        Customer unresolved
                      </span>
                    )}
                  </div>
                  <time dateTime={conversation.lastMessageAt}>
                    {new Date(conversation.lastMessageAt).toLocaleString()}
                  </time>
                </div>
                <p>{conversation.lastMessagePreview}</p>
                <div className="conversation-list-footer">
                  <span>
                    {conversation.messageCount}{" "}
                    {conversation.messageCount === 1 ? "message" : "messages"}
                  </span>
                  <Link
                    className="customer-action-link"
                    href={`/inbox/${conversation.id}`}
                  >
                    Open Conversation
                  </Link>
                  {canManageArchivedConversations && (
                    <button
                      className={`account-button${archive === "archived" ? " account-button-secondary" : " account-button-danger"}`}
                      disabled={busy}
                      onClick={() =>
                        void setConversationArchived(
                          conversation,
                          archive !== "archived",
                        )
                      }
                      type="button"
                    >
                      {archive === "archived" ? "Restore" : "Delete"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {continuationToken && (
          <button
            className="account-button account-button-secondary customer-load-more"
            disabled={loading}
            onClick={() => void loadMore()}
            type="button"
          >
            {loading ? "Loading..." : "Load more"}
          </button>
        )}
      </section>

    </>
  );
}
