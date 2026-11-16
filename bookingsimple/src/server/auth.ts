import "server-only";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { parseSessionToken, secureEqual, sha256 } from "./auth-crypto";
import { isExpired } from "./auth-policy";
import {
  controlContainer,
  createDocument,
  readDocument,
  sessionContainer,
  type AuthDocument,
  type Versioned,
} from "./auth-storage";
import { resolveTenantContext } from "./tenant-context";
import type { UserView, Viewer } from "./auth-types";

export const AUTH_COOKIE_NAME = "booksimple_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export type UserDocument = AuthDocument & {
  type: "user";
  userId: string;
  email: string;
  name: string;
  status: "pending" | "active" | "disabled";
  passwordHash: string;
  emailVerified: boolean;
  platformAdmin: boolean;
  authVersion: number;
  createdAt: string;
  updatedAt: string;
  membership?: {
    tenantId: string;
    username: string;
    role: "company_admin" | "company_user";
  };
  application?: {
    businessId: string;
    businessName: string;
    status: "pending" | "approved" | "rejected";
  };
  mfaEnabled: boolean;
  mfaSecret?: string;
  pendingMfaSecret?: string;
  lastTotpStep?: number;
  backupCodeHashes?: string[];
};

export type SessionDocument = AuthDocument & {
  type: "session";
  userId: string;
  tokenHash: string;
  authVersion: number;
  mfaVerified: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type AuthenticatedSession = {
  user: Versioned<UserDocument>;
  session: Versioned<SessionDocument>;
};

export function toUserView(user: UserDocument): UserView {
  return {
    id: user.userId,
    email: user.email,
    name: user.name,
    status: user.status,
    platformAdmin: user.platformAdmin,
    emailVerified: user.emailVerified,
    mfaEnabled: user.mfaEnabled,
    ...(user.membership ? { membership: user.membership } : {}),
    ...(user.application
      ? {
          application: {
            businessName: user.application.businessName,
            status: user.application.status,
          },
        }
      : {}),
  };
}

export async function resolveSessionToken(
  token: string,
): Promise<AuthenticatedSession | null> {
  const parsed = parseSessionToken(token);
  if (!parsed) {
    return null;
  }
  const sessionResult = await readDocument<SessionDocument>(
    sessionContainer(),
    parsed.sessionId,
    parsed.accountKey,
  );
  if (
    !sessionResult ||
    sessionResult.document.type !== "session" ||
    sessionResult.document.revokedAt ||
    isExpired(sessionResult.document.expiresAt) ||
    !secureEqual(sessionResult.document.tokenHash, sha256(token))
  ) {
    return null;
  }
  const userResult = await readDocument<UserDocument>(
    controlContainer(),
    "user",
    parsed.accountKey,
  );
  if (
    !userResult ||
    userResult.document.type !== "user" ||
    userResult.document.id !== "user" ||
    userResult.document.userId !== sessionResult.document.userId ||
    userResult.document.status !== "active" ||
    !userResult.document.emailVerified ||
    userResult.document.authVersion !== sessionResult.document.authVersion
  ) {
    return null;
  }
  return { user: userResult, session: sessionResult };
}

export async function getViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return getViewerForToken(token);
}

export async function getViewerForToken(token: string): Promise<Viewer | null> {
  const authenticated = await resolveSessionToken(token);
  if (!authenticated) {
    return null;
  }
  const user = toUserView(authenticated.user.document);
  const tenant = await resolveTenantContext(authenticated.user.document);
  if (user.membership && !tenant) {
    delete user.membership;
  }
  return {
    user,
    mfaVerified: authenticated.session.document.mfaVerified,
    ...(tenant ? { tenant } : {}),
  };
}

export async function createSession(
  user: UserDocument,
  mfaVerified: boolean,
): Promise<{ token: string; document: SessionDocument }> {
  const sessionId = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `${user.partitionKey}.${sessionId}.${secret}`;
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + SESSION_SECONDS * 1000,
  ).toISOString();
  const document: SessionDocument = {
    id: sessionId,
    partitionKey: user.partitionKey,
    type: "session",
    schemaVersion: 1,
    userId: user.userId,
    tokenHash: sha256(token),
    authVersion: user.authVersion,
    mfaVerified,
    createdAt: createdAt.toISOString(),
    expiresAt,
    ttl: SESSION_SECONDS,
  };
  await createDocument(sessionContainer(), document);
  return { token, document };
}

export async function revokeSession(
  accountKey: string,
  sessionId: string,
): Promise<void> {
  const current = await readDocument<SessionDocument>(
    sessionContainer(),
    sessionId,
    accountKey,
  );
  if (!current || current.document.revokedAt) {
    return;
  }
  const next: SessionDocument = {
    ...current.document,
    revokedAt: new Date().toISOString(),
  };
  const { replaceDocument } = await import("./auth-storage");
  await replaceDocument(sessionContainer(), next, current.etag);
}

export async function setAuthCookie(token: string): Promise<void> {
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  (await cookies()).set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
    maxAge: SESSION_SECONDS,
  });
}

export async function clearAuthCookie(): Promise<void> {
  (await cookies()).set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}
