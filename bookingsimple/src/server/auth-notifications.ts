import "server-only";

import {
  decryptJson,
  encryptJson,
  randomToken,
} from "./auth-crypto";
import {
  controlContainer,
  readDocument,
  replaceDocument,
  type AuthDocument,
} from "./auth-storage";

const NOTIFICATION_KEY = "AUTH_NOTIFICATION_ENCRYPTION_KEY";

export type NotificationPayload = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
};

type NotificationDocument = AuthDocument & {
  type: "notification";
  userId: string;
  event:
    | "email-verification"
    | "password-reset"
    | "application-approved"
    | "application-rejected"
    | "business-invitation";
  status: "pending" | "sent" | "failed";
  encryptedPayload?: string;
  createdAt: string;
  sentAt?: string;
  lastAttemptAt?: string;
  failureCode?: "configuration" | "timeout" | "provider" | "unknown";
};

function encryptPayload(payload: NotificationPayload): string {
  return encryptJson(payload, NOTIFICATION_KEY);
}

function decryptPayload(encrypted: string): NotificationPayload {
  return decryptJson<NotificationPayload>(encrypted, NOTIFICATION_KEY);
}

export function makeNotification(
  accountKey: string,
  userId: string,
  event: NotificationDocument["event"],
  payload: NotificationPayload,
): NotificationDocument {
  return {
    id: `notification_${randomToken(16)}`,
    partitionKey: accountKey,
    type: "notification",
    schemaVersion: 1,
    userId,
    event,
    status: "pending",
    encryptedPayload: encryptPayload(payload),
    createdAt: new Date().toISOString(),
    ttl: 31_536_000,
  };
}

function safeFailureCode(error: unknown): NotificationDocument["failureCode"] {
  if (!process.env.POSTMARK_SERVER_TOKEN || !process.env.POSTMARK_FROM_EMAIL) {
    return "configuration";
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }
  if (error instanceof ProviderError) {
    return "provider";
  }
  return "unknown";
}

class ProviderError extends Error {
  constructor(
    readonly providerStatus?: number,
    readonly providerCode?: number,
  ) {
    super("Notification provider did not accept the message.");
  }
}

export async function sendWithPostmark(payload: NotificationPayload): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  if (!token || !from) {
    throw new Error("Postmark is not configured.");
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: payload.to,
      Subject: payload.subject,
      TextBody: payload.textBody,
      HtmlBody: payload.htmlBody,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const result: unknown = await response.json().catch(() => null);
  const providerCode =
    result &&
    typeof result === "object" &&
    "ErrorCode" in result &&
    typeof result.ErrorCode === "number" &&
    Number.isInteger(result.ErrorCode)
      ? result.ErrorCode
      : undefined;
  if (!response.ok || providerCode !== 0) {
    throw new ProviderError(response.status, providerCode);
  }
}

function logNotificationFailure(
  failureCode: NotificationDocument["failureCode"],
  error: unknown,
): void {
  const details: {
    event: string;
    category: NotificationDocument["failureCode"];
    providerStatus?: number;
    providerCode?: number;
  } = {
    event: "auth-notification-delivery-failed",
    category: failureCode ?? "unknown",
  };
  if (error instanceof ProviderError) {
    if (Number.isInteger(error.providerStatus)) {
      details.providerStatus = error.providerStatus;
    }
    if (Number.isInteger(error.providerCode)) {
      details.providerCode = error.providerCode;
    }
  }
  console.error(JSON.stringify(details));
}

export async function deliverNotification(
  accountKey: string,
  notificationId: string,
): Promise<boolean> {
  const container = controlContainer();
  const current = await readDocument<NotificationDocument>(
    container,
    notificationId,
    accountKey,
  );
  if (!current || current.document.type !== "notification") {
    throw new Error("Notification record is unavailable.");
  }
  if (current.document.status === "sent") {
    return true;
  }
  if (!current.document.encryptedPayload) {
    throw new Error("Notification payload is unavailable.");
  }

  let failureCode: NotificationDocument["failureCode"];
  try {
    await sendWithPostmark(decryptPayload(current.document.encryptedPayload));
  } catch (error) {
    failureCode = safeFailureCode(error);
    logNotificationFailure(failureCode, error);
  }

  const next: NotificationDocument = {
    ...current.document,
    lastAttemptAt: new Date().toISOString(),
    status: failureCode ? "failed" : "sent",
    ...(failureCode
      ? { failureCode }
      : { sentAt: new Date().toISOString(), encryptedPayload: undefined }),
  };
  await replaceDocument(container, next, current.etag);
  return !failureCode;
}

export function verificationEmail(
  email: string,
  name: string,
  token: string,
): NotificationPayload {
  const link = `${applicationOrigin()}/verify?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name);
  return {
    to: email,
    subject: "Verify your BookSimple email",
    textBody: `Hello ${name},\n\nVerify your email address: ${link}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this message.`,
    htmlBody: `<p>Hello ${safeName},</p><p><a href="${link}">Verify your email address</a></p><p>This link expires in 24 hours. If you did not create an account, you can ignore this message.</p>`,
  };
}

export function resetEmail(
  email: string,
  name: string,
  token: string,
): NotificationPayload {
  const link = `${applicationOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name);
  return {
    to: email,
    subject: "Reset your BookSimple password",
    textBody: `Hello ${name},\n\nReset your password: ${link}\n\nThis link expires in one hour. If you did not request this, you can ignore this message.`,
    htmlBody: `<p>Hello ${safeName},</p><p><a href="${link}">Reset your password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this message.</p>`,
  };
}

export function decisionEmail(
  email: string,
  name: string,
  approved: boolean,
): NotificationPayload {
  const subject = approved
    ? "Your BookSimple business application was approved"
    : "Your BookSimple business application was not approved";
  const message = approved
    ? "Your business application has been approved. You can now sign in to access your workspace."
    : "Your business application was not approved. You can sign in to view your application status.";
  return {
    to: email,
    subject,
    textBody: `Hello ${name},\n\n${message}`,
    htmlBody: `<p>Hello ${escapeHtml(name)},</p><p>${message}</p>`,
  };
}

export function invitationEmail(
  email: string,
  businessName: string,
  token: string,
): NotificationPayload {
  const link = `${applicationOrigin()}/invite?token=${encodeURIComponent(token)}`;
  const safeBusinessName = escapeHtml(businessName);
  return {
    to: email,
    subject: "You have been invited to BookSimple",
    textBody: `You have been invited to join ${businessName} on BookSimple.\n\nReview and accept the invitation: ${link}\n\nSign in or register with this email address before accepting. This invitation expires in seven days.`,
    htmlBody: `<p>You have been invited to join ${safeBusinessName} on BookSimple.</p><p><a href="${link}">Review and accept the invitation</a></p><p>Sign in or register with this email address before accepting. This invitation expires in seven days.</p>`,
  };
}

export function applicationOrigin(): string {
  const value = process.env.APP_ORIGIN?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: APP_ORIGIN");
  }
  const origin = new URL(value);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== value.replace(/\/$/, "") ||
    (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
  ) {
    throw new Error("APP_ORIGIN must be an HTTPS application origin.");
  }
  return origin.origin;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}
