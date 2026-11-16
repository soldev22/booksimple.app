import "server-only";

import { randomUUID, randomBytes } from "node:crypto";
import { Secret } from "otpauth";
import {
  AuthPolicyError,
  assertAssignableToTenant,
  isExpired,
  requirePlatformAccess,
} from "./auth-policy";
import {
  accountPartition,
  decryptJson,
  encryptJson,
  hashPassword,
  normalizeEmail,
  randomToken,
  secureEqual,
  sha256,
  verifyPassword,
} from "./auth-crypto";
import {
  AUTH_COOKIE_NAME,
  createSession,
  resolveSessionToken,
  revokeSession,
  toUserView,
  type UserDocument,
} from "./auth";
import {
  consumeRateLimit,
  controlContainer,
  createDocument,
  deleteDocument,
  isConflict,
  isPreconditionFailed,
  queryPage,
  readDocument,
  replaceDocument,
  StorageError,
  type AuthDocument,
  type Versioned,
} from "./auth-storage";
import {
  decisionEmail,
  deliverNotification,
  makeNotification,
  resetEmail,
  verificationEmail,
} from "./auth-notifications";
import { acceptedTotpStep, createTotp } from "./auth-totp";
import type { BusinessView, UserView, Viewer } from "./auth-types";
import type { AuthAction } from "./auth-validation";

const ACCOUNT_MEMBERSHIP_ID = "user";
const MFA_KEY = "AUTH_MFA_ENCRYPTION_KEY";
const EMAIL_VERIFY_TTL = 24 * 60 * 60;
const PASSWORD_RESET_TTL = 60 * 60;
const MAX_BUSINESS_MEMBERS = 200;
const BACKUP_CODE_COUNT = 10;

type BatchResponse = {
  code?: number;
  result?: { statusCode: number }[];
};

function batchFailureCode(response: BatchResponse): number | undefined {
  return response.result?.find(
    (operation) => operation.statusCode < 200 || operation.statusCode >= 300,
  )?.statusCode;
}

function batchSucceeded(response: BatchResponse): boolean {
  const code = response.code ?? 503;
  return (
    code >= 200 &&
    code < 300 &&
    batchFailureCode(response) === undefined
  );
}

export async function replaceUserWithAdminAudit(
  current: Versioned<UserDocument>,
  updated: UserDocument,
  actor: UserDocument,
  action: string,
  tenantId?: string,
): Promise<void> {
  const audit: AffectedAccountAuditDocument = {
    id: `account_audit_${randomUUID()}`,
    partitionKey: current.document.partitionKey,
    type: "affected-account-audit",
    schemaVersion: 1,
    actorUserId: actor.userId,
    action,
    affectedUserId: current.document.userId,
    ...(tenantId ? { affectedTenantId: tenantId } : {}),
    outcome: "succeeded",
    createdAt: new Date().toISOString(),
    ttl: 31_536_000,
  };
  const response = await controlContainer().items.batch(
    [
      {
        operationType: "Replace",
        id: updated.id,
        resourceBody: updated,
        ifMatch: current.etag,
      },
      { operationType: "Create", resourceBody: audit },
    ],
    current.document.partitionKey,
  );
  if (!batchSucceeded(response)) {
    const failureCode = batchFailureCode(response);
    if (failureCode === 412 || response.code === 412) {
      throw authError(409, "The user's record changed. Refresh and retry.");
    }
    throw authError(503, "The user update and audit could not be completed.");
  }
}

export type AuthActionResult = {
  status: number;
  body: {
    message?: string;
    error?: string;
    redirect?: string;
    secret?: string;
    uri?: string;
    backupCodes?: string[];
  };
  sessionToken?: string;
  clearCookie?: boolean;
};

type BusinessDocument = AuthDocument & {
  type: "business";
  name: string;
  status: "pending" | "active" | "rejected" | "disabled";
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type TokenDocument = AuthDocument & {
  type: "email-verification" | "password-reset";
  userId: string;
  tokenHash: string;
  expiresAt: string;
  authVersion: number;
  usedAt?: string;
};

type MembershipReservation = AuthDocument & {
  type: "membership-reservation";
  userId: string;
  username: string;
  role: "company_admin" | "company_user";
  status: "active" | "released";
  operationId: string;
  createdAt: string;
  releasedAt?: string;
};

type AuditDocument = AuthDocument & {
  type: "platform-admin-audit";
  actorUserId: string;
  action: string;
  affectedUserId: string;
  affectedTenantId?: string;
  outcome: "started" | "succeeded" | "failed";
  createdAt: string;
  completedAt?: string;
  ttl: 31_536_000;
};

type AffectedAccountAuditDocument = AuthDocument & {
  type: "affected-account-audit";
  actorUserId: string;
  action: string;
  affectedUserId: string;
  affectedTenantId?: string;
  outcome: "succeeded";
  createdAt: string;
  ttl: 31_536_000;
};

function authError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function accountKeyFromToken(token: string): string | null {
  const accountKey = token.split(".", 1)[0];
  return /^account_[a-f0-9]{64}$/.test(accountKey) ? accountKey : null;
}

function userToken(token: string, type: TokenDocument["type"]): TokenDocument {
  const accountKey = accountKeyFromToken(token);
  if (!accountKey) {
    throw authError(400, "The link is invalid or has expired.");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
    throw authError(400, "The link is invalid or has expired.");
  }
  return {
    id: `${type === "email-verification" ? "verify" : "reset"}_${sha256(token)}`,
    partitionKey: accountKey,
    type,
    schemaVersion: 1,
    userId: "",
    tokenHash: sha256(token),
    authVersion: 0,
    expiresAt: "",
  };
}

function createOneTimeToken(accountKey: string): string {
  return `${accountKey}.${randomToken(32)}`;
}

function tokenDocument(
  token: string,
  accountKey: string,
  userId: string,
  type: TokenDocument["type"],
  authVersion: number,
  ttl: number,
): TokenDocument {
  return {
    id: `${type === "email-verification" ? "verify" : "reset"}_${sha256(token)}`,
    partitionKey: accountKey,
    type,
    schemaVersion: 1,
    userId,
    tokenHash: sha256(token),
    authVersion,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    ttl,
  };
}

function decodeTotpSecret(encrypted: string): string {
  return decryptJson<string>(encrypted, MFA_KEY);
}

function normalizedBackupCode(code: string): string {
  return code.replace(/[\s-]/g, "").toLowerCase();
}

function backupCodeHash(userId: string, code: string): string {
  return sha256(`${userId}:${normalizedBackupCode(code)}`);
}

function isValidHash(hash: string, candidate: string): boolean {
  return secureEqual(hash, candidate);
}

async function findUserByEmail(
  email: string,
): Promise<Versioned<UserDocument> | null> {
  const key = accountPartition(normalizeEmail(email));
  const result = await readDocument<UserDocument>(
    controlContainer(),
    ACCOUNT_MEMBERSHIP_ID,
    key,
  );
  return result?.document.type === "user" ? result : null;
}

async function findUserById(
  userId: string,
): Promise<Versioned<UserDocument> | null> {
  const control = controlContainer();
  const iterator = control.items.query<{ partitionKey: string }>(
    {
      query: "SELECT c.partitionKey FROM c WHERE c.type = @type AND c.userId = @userId",
      parameters: [
        { name: "@type", value: "user" },
        { name: "@userId", value: userId },
      ],
    },
    { maxItemCount: 2 },
  );
  const result = await iterator.fetchNext();
  if (result.resources.length > 1) {
    throw authError(503, "The user record is not unique.");
  }
  const resource = result.resources[0];
  if (!resource) {
    return null;
  }
  return readDocument<UserDocument>(control, "user", resource.partitionKey);
}

async function createRegistration(
  name: string,
  email: string,
  password: string,
  businessName?: string,
): Promise<AuthActionResult> {
  const emailKey = accountPartition(normalizeEmail(email));
  const userId = randomUUID();
  const businessId = businessName ? randomUUID() : undefined;
  const now = new Date().toISOString();
  const user: UserDocument = {
    id: ACCOUNT_MEMBERSHIP_ID,
    userId,
    partitionKey: emailKey,
    type: "user",
    schemaVersion: 1,
    email,
    name,
    status: "pending",
    passwordHash: await hashPassword(password),
    emailVerified: false,
    platformAdmin: false,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    mfaEnabled: false,
    ...(businessName && businessId
      ? {
          application: {
            businessId,
            businessName,
            status: "pending" as const,
          },
        }
      : {}),
  };
  const verificationToken = createOneTimeToken(emailKey);
  const verification = tokenDocument(
    verificationToken,
    emailKey,
    userId,
    "email-verification",
    user.authVersion,
    EMAIL_VERIFY_TTL,
  );
  const notification = makeNotification(
    emailKey,
    userId,
    "email-verification",
    verificationEmail(email, name, verificationToken),
  );
  const control = controlContainer();
  let createdBusiness = false;
  if (businessName && businessId) {
    const business: BusinessDocument = {
      id: businessId,
      partitionKey: businessId,
      type: "business",
      schemaVersion: 1,
      name: businessName,
      status: "pending",
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await createDocument(control, business);
      createdBusiness = true;
    } catch {
      throw authError(503, "Registration could not be completed. Please retry.");
    }
  }

  try {
    await control.items.batch(
      [
        { operationType: "Create", resourceBody: user },
        {
          operationType: "Create",
          resourceBody: {
            id: "email-index",
            partitionKey: emailKey,
            type: "email-index",
            schemaVersion: 1,
            normalizedEmail: email,
            userId,
          },
        },
        { operationType: "Create", resourceBody: verification },
        { operationType: "Create", resourceBody: notification },
      ],
      emailKey,
    ).then((response) => {
      const failedCode = batchFailureCode(response);
      if (!batchSucceeded(response)) {
        if (failedCode === 409 || failedCode === 412) {
          throw authError(409, "An account with this email already exists.");
        }
        throw authError(503, "Registration could not be completed. Please retry.");
      }
    });
  } catch (error) {
    if (createdBusiness && businessId) {
      try {
        await deleteDocument(control, businessId, businessId);
      } catch {
        throw authError(
          503,
          "Registration could not be completed. Please contact support.",
        );
      }
    }
    if (error instanceof StorageError) {
      throw error;
    }
    if (isConflict(error)) {
      throw authError(409, "An account with this email already exists.");
    }
    throw authError(503, "Registration could not be completed. Please retry.");
  }

  if (!(await deliverNotification(emailKey, notification.id))) {
    throw authError(
      503,
      "Your account was created, but the verification email could not be sent. Request a new verification email to continue.",
    );
  }
  return {
    status: 201,
    body: {
      message: "Check your email to verify your account.",
      redirect: "/login?verification=sent",
    },
  };
}

async function resendVerification(email: string): Promise<AuthActionResult> {
  const userResult = await findUserByEmail(email);
  if (
    !userResult ||
    userResult.document.emailVerified ||
    userResult.document.status === "disabled"
  ) {
    return {
      status: 200,
      body: { message: "If verification is needed, an email will be sent." },
    };
  }
  const user = userResult.document;
  const token = createOneTimeToken(user.partitionKey);
  const tokenRecord = tokenDocument(
    token,
    user.partitionKey,
    user.userId,
    "email-verification",
    user.authVersion,
    EMAIL_VERIFY_TTL,
  );
  const notification = makeNotification(
    user.partitionKey,
    user.userId,
    "email-verification",
    verificationEmail(user.email, user.name, token),
  );
  const batch = await controlContainer().items.batch(
    [
      { operationType: "Create", resourceBody: tokenRecord },
      { operationType: "Create", resourceBody: notification },
    ],
    user.partitionKey,
  );
  if (!batchSucceeded(batch)) {
    throw authError(503, "A verification email could not be queued. Please retry.");
  }
  if (!(await deliverNotification(user.partitionKey, notification.id))) {
    throw authError(
      503,
      "The verification email could not be sent. Please try again later.",
    );
  }
  return {
    status: 200,
    body: { message: "If verification is needed, an email will be sent." },
  };
}

async function login(email: string, password: string): Promise<AuthActionResult> {
  const userResult = await findUserByEmail(email);
  const dummyHash =
    dummyPasswordHash ?? (dummyPasswordHash = hashPassword("invalid-login-password"));
  const encoded = userResult?.document.passwordHash ?? (await dummyHash);
  const matches = await verifyPassword(password, encoded);
  if (
    !matches ||
    !userResult ||
    userResult.document.status === "disabled"
  ) {
    throw authError(401, "The email or password is incorrect.");
  }
  if (!userResult.document.emailVerified) {
    throw authError(403, "Please verify your email to proceed.");
  }
  if (userResult.document.status !== "active") {
    throw authError(401, "The email or password is incorrect.");
  }
  const user = userResult.document;
  const session = await createSession(user, false);
  return {
    status: 200,
    body: { message: "Signed in.", redirect: "/account" },
    sessionToken: session.token,
  };
}

let dummyPasswordHash: Promise<string> | undefined;

async function verifyEmail(token: string): Promise<AuthActionResult> {
  const record = userToken(token, "email-verification");
  const control = controlContainer();
  const tokenResult = await readDocument<TokenDocument>(
    control,
    record.id,
    record.partitionKey,
  );
  if (
    !tokenResult ||
    tokenResult.document.type !== "email-verification" ||
    tokenResult.document.usedAt ||
    isExpired(tokenResult.document.expiresAt) ||
    !secureEqual(tokenResult.document.tokenHash, record.tokenHash)
  ) {
    throw authError(400, "The link is invalid or has expired.");
  }
  const userResult = await readDocument<UserDocument>(
    control,
    ACCOUNT_MEMBERSHIP_ID,
    record.partitionKey,
  );
  if (
    !userResult ||
    userResult.document.userId !== tokenResult.document.userId ||
    userResult.document.status === "disabled"
  ) {
    throw authError(400, "The link is invalid or has expired.");
  }
  const updatedUser: UserDocument = {
    ...userResult.document,
    status: "active",
    emailVerified: true,
    updatedAt: new Date().toISOString(),
  };
  const updatedToken: TokenDocument = {
    ...tokenResult.document,
    usedAt: new Date().toISOString(),
  };
  const response = await control.items.batch(
    [
      {
        operationType: "Replace",
        id: updatedUser.id,
        resourceBody: updatedUser,
        ifMatch: userResult.etag,
      },
      {
        operationType: "Replace",
        id: updatedToken.id,
        resourceBody: updatedToken,
        ifMatch: tokenResult.etag,
      },
    ],
    record.partitionKey,
  );
  if (!batchSucceeded(response)) {
    throw authError(400, "The link is invalid or has expired.");
  }
  return {
    status: 200,
    body: { message: "Email verified. You can now sign in.", redirect: "/login?verified=1" },
  };
}

async function requestPasswordReset(email: string): Promise<AuthActionResult> {
  const userResult = await findUserByEmail(email);
  if (
    userResult &&
    userResult.document.emailVerified &&
    userResult.document.status === "active"
  ) {
    const user = userResult.document;
    const token = createOneTimeToken(user.partitionKey);
    const tokenRecord = tokenDocument(
      token,
      user.partitionKey,
      user.userId,
      "password-reset",
      user.authVersion,
      PASSWORD_RESET_TTL,
    );
    const notification = makeNotification(
      user.partitionKey,
      user.userId,
      "password-reset",
      resetEmail(user.email, user.name, token),
    );
    const batch = await controlContainer().items.batch(
      [
        { operationType: "Create", resourceBody: tokenRecord },
        { operationType: "Create", resourceBody: notification },
      ],
      user.partitionKey,
    );
    if (!batchSucceeded(batch)) {
      throw authError(503, "The reset request could not be completed.");
    }
    if (!(await deliverNotification(user.partitionKey, notification.id))) {
      throw authError(
        503,
        "The reset email could not be sent. Please try again later.",
      );
    }
  }
  return {
    status: 200,
    body: {
      message: "If the account exists, password reset instructions will be sent.",
      redirect: "/login?reset=sent",
    },
  };
}

async function resetPassword(
  token: string,
  password: string,
): Promise<AuthActionResult> {
  const record = userToken(token, "password-reset");
  const control = controlContainer();
  const tokenResult = await readDocument<TokenDocument>(
    control,
    record.id,
    record.partitionKey,
  );
  if (
    !tokenResult ||
    tokenResult.document.type !== "password-reset" ||
    tokenResult.document.usedAt ||
    isExpired(tokenResult.document.expiresAt) ||
    !secureEqual(tokenResult.document.tokenHash, record.tokenHash)
  ) {
    throw authError(400, "The link is invalid or has expired.");
  }
  const userResult = await readDocument<UserDocument>(
    control,
    ACCOUNT_MEMBERSHIP_ID,
    record.partitionKey,
  );
  if (
    !userResult ||
    userResult.document.userId !== tokenResult.document.userId ||
    userResult.document.authVersion !== tokenResult.document.authVersion ||
    !userResult.document.emailVerified ||
    userResult.document.status !== "active"
  ) {
    throw authError(400, "The link is invalid or has expired.");
  }
  const updatedUser: UserDocument = {
    ...userResult.document,
    passwordHash: await hashPassword(password),
    authVersion: userResult.document.authVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  const updatedToken: TokenDocument = {
    ...tokenResult.document,
    usedAt: new Date().toISOString(),
  };
  const response = await control.items.batch(
    [
      {
        operationType: "Replace",
        id: updatedUser.id,
        resourceBody: updatedUser,
        ifMatch: userResult.etag,
      },
      {
        operationType: "Replace",
        id: updatedToken.id,
        resourceBody: updatedToken,
        ifMatch: tokenResult.etag,
      },
    ],
    record.partitionKey,
  );
  if (!batchSucceeded(response)) {
    throw authError(400, "The link is invalid or has expired.");
  }
  return {
    status: 200,
    body: {
      message: "Your password was reset. Sign in with your new password.",
      redirect: "/login?reset=complete",
    },
  };
}

async function requireOwnSession(request: Request) {
  const token = requestCookie(request, AUTH_COOKIE_NAME);
  if (!token) {
    throw authError(401, "Sign in is required.");
  }
  const current = await resolveSessionToken(token);
  if (!current) {
    throw authError(401, "Sign in is required.");
  }
  return { token, ...current };
}

async function consumeMfaRate(
  accountKey: string,
  sessionId: string,
  action: string,
  maximum: number,
): Promise<void> {
  await consumeRateLimit(
    `mfa-${action}`,
    accountKey,
    maximum,
    600,
  );
  await consumeRateLimit(
    `mfa-${action}`,
    `${accountKey}:${sessionId}`,
    maximum,
    600,
  );
}

function requestCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) {
    return null;
  }
  for (const part of raw.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function setupMfa(request: Request): Promise<AuthActionResult> {
  const { user, session } = await requireOwnSession(request);
  await consumeMfaRate(
    user.document.partitionKey,
    session.document.id,
    "setup",
    3,
  );
  if (user.document.mfaEnabled) {
    throw authError(409, "Authenticator MFA is already enabled.");
  }
  const secret = new Secret({ size: 20 });
  const totp = createTotp(secret.base32, user.document.email);
  const updated: UserDocument = {
    ...user.document,
    pendingMfaSecret: encryptJson(secret.base32, MFA_KEY),
    updatedAt: new Date().toISOString(),
  };
  await replaceDocument(controlContainer(), updated, user.etag);
  return {
    status: 200,
    body: { secret: secret.base32, uri: totp.toString() },
  };
}

async function enableMfa(
  request: Request,
  code: string,
): Promise<AuthActionResult> {
  const { user, session } = await requireOwnSession(request);
  await consumeMfaRate(
    user.document.partitionKey,
    session.document.id,
    "enable",
    6,
  );
  if (user.document.mfaEnabled || !user.document.pendingMfaSecret) {
    throw authError(409, "Start authenticator setup before enabling MFA.");
  }
  const secret = decodeTotpSecret(user.document.pendingMfaSecret);
  const step = acceptedTotpStep(
    createTotp(secret, user.document.email),
    code,
    user.document.lastTotpStep ?? -1,
  );
  if (step === null) {
    throw authError(400, "The authenticator code is invalid or already used.");
  }
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    randomBytes(10).toString("hex"),
  );
  const updated: UserDocument = {
    ...user.document,
    mfaEnabled: true,
    mfaSecret: user.document.pendingMfaSecret,
    pendingMfaSecret: undefined,
    lastTotpStep: step,
    backupCodeHashes: backupCodes.map((backupCode) =>
      backupCodeHash(user.document.userId, backupCode),
    ),
    updatedAt: new Date().toISOString(),
  };
  const saved = await replaceDocument(controlContainer(), updated, user.etag);
  const newSession = await createSession(saved.document, true);
  return {
    status: 200,
    body: {
      message: "Authenticator MFA is enabled. Save your backup codes securely.",
      backupCodes,
    },
    sessionToken: newSession.token,
  };
}

async function completeMfa(
  request: Request,
  code: string,
): Promise<AuthActionResult> {
  const current = await requireOwnSession(request);
  await consumeMfaRate(
    current.user.document.partitionKey,
    current.session.document.id,
    "challenge",
    8,
  );
  const user = current.user.document;
  if (!user.mfaEnabled || !user.mfaSecret) {
    throw authError(409, "Authenticator MFA is not enabled.");
  }
  const secret = decodeTotpSecret(user.mfaSecret);
  const step = acceptedTotpStep(
    createTotp(secret, user.email),
    code,
    user.lastTotpStep ?? -1,
  );
  if (step === null) {
    throw authError(401, "The authenticator code is invalid or already used.");
  }
  const updated: UserDocument = {
    ...user,
    lastTotpStep: step,
    updatedAt: new Date().toISOString(),
  };
  const saved = await replaceDocument(controlContainer(), updated, current.user.etag);
  const session = await createSession(saved.document, true);
  await revokeSession(current.session.document.partitionKey, current.session.document.id);
  return {
    status: 200,
    body: { message: "MFA verified.", redirect: "/account" },
    sessionToken: session.token,
  };
}

async function recoverMfa(
  request: Request,
  code: string,
): Promise<AuthActionResult> {
  const current = await requireOwnSession(request);
  await consumeMfaRate(
    current.user.document.partitionKey,
    current.session.document.id,
    "recovery",
    5,
  );
  const user = current.user.document;
  if (!user.mfaEnabled || !user.backupCodeHashes?.length) {
    throw authError(409, "MFA recovery is not available.");
  }
  const candidate = backupCodeHash(user.userId, code);
  const usedIndex = user.backupCodeHashes.findIndex((hash) =>
    isValidHash(hash, candidate),
  );
  if (usedIndex < 0) {
    throw authError(401, "The backup code is invalid or already used.");
  }
  const updated: UserDocument = {
    ...user,
    backupCodeHashes: user.backupCodeHashes.filter(
      (_hash, index) => index !== usedIndex,
    ),
    updatedAt: new Date().toISOString(),
  };
  const saved = await replaceDocument(controlContainer(), updated, current.user.etag);
  const session = await createSession(saved.document, true);
  await revokeSession(current.session.document.partitionKey, current.session.document.id);
  return {
    status: 200,
    body: { message: "Recovery code accepted.", redirect: "/account" },
    sessionToken: session.token,
  };
}

async function logout(request: Request): Promise<AuthActionResult> {
  const token = requestCookie(request, AUTH_COOKIE_NAME);
  if (token) {
    const current = await resolveSessionToken(token);
    if (current) {
      await revokeSession(
        current.session.document.partitionKey,
        current.session.document.id,
      );
    }
  }
  return {
    status: 200,
    body: { message: "Signed out.", redirect: "/login" },
    clearCookie: true,
  };
}

function createAudit(
  actor: UserDocument,
  action: string,
  affectedUserId: string,
  tenantId?: string,
): AuditDocument {
  return {
    id: `audit_${randomUUID()}`,
    partitionKey: actor.partitionKey,
    type: "platform-admin-audit",
    schemaVersion: 1,
    actorUserId: actor.userId,
    action,
    affectedUserId,
    ...(tenantId ? { affectedTenantId: tenantId } : {}),
    outcome: "started",
    createdAt: new Date().toISOString(),
    ttl: 31_536_000,
  };
}

async function withAudit<T>(
  actor: UserDocument,
  action: string,
  affectedUserId: string,
  operation: () => Promise<T>,
  tenantId?: string,
): Promise<T> {
  const container = controlContainer();
  const audit = createAudit(actor, action, affectedUserId, tenantId);
  let current: Versioned<AuditDocument>;
  try {
    current = await createDocument(container, audit);
  } catch {
    throw authError(503, "The administrator audit log is unavailable.");
  }
  try {
    const result = await operation();
    const finished: AuditDocument = {
      ...current.document,
      outcome: "succeeded",
      completedAt: new Date().toISOString(),
    };
    await replaceDocument(container, finished, current.etag);
    return result;
  } catch (error) {
    const failed: AuditDocument = {
      ...current.document,
      outcome: "failed",
      completedAt: new Date().toISOString(),
    };
    try {
      await replaceDocument(container, failed, current.etag);
    } catch {
      throw authError(
        503,
        "The administrator action failed and its audit record needs review.",
      );
    }
    throw error;
  }
}

function requirePlatformViewer(viewer: Viewer | null): asserts viewer is Viewer {
  requirePlatformAccess(viewer);
}

async function startPlatformAction(request: Request) {
  const current = await requireOwnSession(request);
  requirePlatformViewer({
    user: toUserView(current.user.document),
    mfaVerified: current.session.document.mfaVerified,
  });
  return current.user.document;
}

async function setPlatformRole(
  actor: UserDocument,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const target = await findUserById(userId);
  if (!target || target.document.status !== "active" || !target.document.emailVerified) {
    throw authError(404, "The verified user was not found.");
  }
  await withAudit(
    actor,
    enabled ? "platform-role-granted" : "platform-role-revoked",
    target.document.userId,
    async () => {
      if (target.document.platformAdmin === enabled) {
        return;
      }
      const updated: UserDocument = {
        ...target.document,
        platformAdmin: enabled,
        authVersion: target.document.authVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      try {
        await replaceUserWithAdminAudit(
          target,
          updated,
          actor,
          enabled ? "platform-role-granted" : "platform-role-revoked",
        );
      } catch (error) {
        if (isPreconditionFailed(error)) {
          throw authError(409, "The user changed. Refresh and retry.");
        }
        throw error;
      }
    },
  );
}

async function readBusiness(
  tenantId: string,
): Promise<Versioned<BusinessDocument> | null> {
  const result = await readDocument<BusinessDocument>(
    controlContainer(),
    tenantId,
    tenantId,
  );
  return result?.document.type === "business" ? result : null;
}

async function reserveBusinessMembership(
  tenantId: string,
  userId: string,
  username: string,
  role: "company_admin" | "company_user",
  allowPending = false,
  slotAlreadyCounted = false,
): Promise<{ created: boolean; operationId: string }> {
  const container = controlContainer();
  const normalized = username.toLowerCase();
  const reservationId = `username_${sha256(normalized)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reservation = await readDocument<MembershipReservation>(
      container,
      reservationId,
      tenantId,
    );
    if (reservation) {
      if (reservation.document.type !== "membership-reservation") {
        throw authError(409, "That username is already used by this business.");
      }
      if (reservation.document.status === "active") {
        if (
          reservation.document.userId === userId &&
          reservation.document.username === normalized
        ) {
          return {
            created: false,
            operationId: reservation.document.operationId,
          };
        }
        throw authError(409, "That username is already used by this business.");
      }
    }
    const business = await readBusiness(tenantId);
    if (!business) {
      throw authError(404, "The business was not found.");
    }
    if (
      business.document.status !== "active" &&
      !(allowPending && business.document.status === "pending")
    ) {
      throw authError(409, "The business is not available for assignment.");
    }
    if (!slotAlreadyCounted && business.document.memberCount >= MAX_BUSINESS_MEMBERS) {
      throw authError(
        409,
        "This business has reached its 200-user limit.",
      );
    }
    const now = new Date().toISOString();
    const operationId = randomUUID();
    const updatedBusiness: BusinessDocument = {
      ...business.document,
      memberCount: business.document.memberCount + (slotAlreadyCounted ? 0 : 1),
      updatedAt: now,
    };
    const newReservation: MembershipReservation = {
      id: reservationId,
      partitionKey: tenantId,
      type: "membership-reservation",
      schemaVersion: 1,
      userId,
      username: normalized,
      role,
      status: "active",
      operationId,
      createdAt: now,
    };
    const operations: import("@azure/cosmos").OperationInput[] = [
      {
        operationType: "Replace",
        id: updatedBusiness.id,
        resourceBody: updatedBusiness,
        ifMatch: business.etag,
      },
      reservation
        ? {
            operationType: "Replace",
            id: reservationId,
            resourceBody: newReservation,
            ifMatch: reservation.etag,
          }
        : { operationType: "Create", resourceBody: newReservation },
    ];
    const response = await container.items.batch(operations, tenantId);
    if (batchSucceeded(response)) {
      return { created: true, operationId };
    }
    const failCode = batchFailureCode(response);
    if (failCode === 409) {
      const raced = await readDocument<MembershipReservation>(
        container,
        reservationId,
        tenantId,
      );
      if (
        raced?.document.status === "active" &&
        raced.document.userId === userId &&
        raced.document.username === normalized
      ) {
        return {
          created: false,
          operationId: raced.document.operationId,
        };
      }
      if (raced?.document.status === "active") {
        throw authError(409, "That username is already used by this business.");
      }
      continue;
    }
    if (failCode === 412 || response.code === 412) {
      continue;
    }
    throw authError(503, "The business assignment could not be reserved.");
  }
  throw authError(503, "The business is busy. Please retry the assignment.");
}

async function releaseBusinessMembership(
  tenantId: string,
  username: string,
  userId: string,
  operationId: string,
  decrementCount: boolean,
): Promise<void> {
  const container = controlContainer();
  const id = `username_${sha256(username.toLowerCase())}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reservation = await readDocument<MembershipReservation>(
      container,
      id,
      tenantId,
    );
    if (
      !reservation ||
      reservation.document.status === "released" ||
      reservation.document.userId !== userId ||
      reservation.document.operationId !== operationId
    ) {
      return;
    }
    const operations: import("@azure/cosmos").OperationInput[] = [
      {
        operationType: "Replace",
        id: reservation.document.id,
        resourceBody: {
          ...reservation.document,
          status: "released",
          releasedAt: new Date().toISOString(),
        },
        ifMatch: reservation.etag,
      },
    ];
    if (decrementCount) {
      const business = await readBusiness(tenantId);
      if (business) {
        operations.push({
          operationType: "Replace",
          id: business.document.id,
          resourceBody: {
            ...business.document,
            memberCount: Math.max(0, business.document.memberCount - 1),
            updatedAt: new Date().toISOString(),
          },
          ifMatch: business.etag,
        });
      }
    }
    const response = await container.items.batch(operations, tenantId);
    if (batchSucceeded(response)) {
      return;
    }
    const hasConflict = response.code === 412 || response.result?.some(
      (operation) => operation.statusCode === 412,
    ) === true;
    if (hasConflict) {
      continue;
    }
    throw authError(503, "The previous business assignment could not be released.");
  }
  throw authError(503, "The business is busy. Please retry the assignment.");
}

async function syncMembershipReservation(
  tenantId: string,
  userId: string,
  username: string,
  role: "company_admin" | "company_user",
): Promise<void> {
  const ensured = await reserveBusinessMembership(
    tenantId,
    userId,
    username,
    role,
    false,
    true,
  );
  const id = `username_${sha256(username.toLowerCase())}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reservation = await readDocument<MembershipReservation>(
      controlContainer(),
      id,
      tenantId,
    );
    if (
      !reservation ||
      reservation.document.userId !== userId ||
      reservation.document.status !== "active"
    ) {
      throw authError(409, "The business username reservation changed.");
    }
    if (reservation.document.role === role) {
      return;
    }
    try {
      await replaceDocument(
        controlContainer(),
        { ...reservation.document, role },
        reservation.etag,
      );
      return;
    } catch (error) {
      if (!isPreconditionFailed(error)) {
        throw error;
      }
    }
  }
  if (ensured.created) {
    throw authError(503, "The business username reservation could not be updated.");
  }
  throw authError(503, "The business is busy. Please retry the assignment.");
}

async function setMembership(
  actor: UserDocument,
  userId: string,
  tenantId: string,
  username: string,
  role: "company_admin" | "company_user",
): Promise<void> {
  const target = await findUserById(userId);
  if (!target || target.document.status !== "active" || !target.document.emailVerified) {
    throw authError(404, "The verified user was not found.");
  }
  assertAssignableToTenant(
    { membership: target.document.membership },
    tenantId,
  );
  const normalized = username.toLowerCase();
  const existing = target.document.membership;
  const business = await readBusiness(tenantId);
  if (!business || business.document.status !== "active") {
    throw authError(404, "The active business was not found.");
  }
  if (existing && existing.tenantId !== tenantId) {
    throw authError(409, "A user cannot be transferred to another business.");
  }

  await withAudit(
    actor,
    "business-user-assigned",
    target.document.userId,
    async () => {
      if (
        existing &&
        existing.username.toLowerCase() === normalized &&
        existing.role === role
      ) {
        await syncMembershipReservation(
          tenantId,
          userId,
          normalized,
          role,
        );
        return;
      }
      const reservationState = await reserveBusinessMembership(
        tenantId,
        userId,
        normalized,
        role,
        false,
        Boolean(existing),
      );
      const updated: UserDocument = {
        ...target.document,
        membership: { tenantId, username: normalized, role },
        authVersion: target.document.authVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      try {
        await replaceUserWithAdminAudit(
          target,
          updated,
          actor,
          "business-user-assigned",
          tenantId,
        );
      } catch (error) {
        const latest = await readDocument<UserDocument>(
          controlContainer(),
          ACCOUNT_MEMBERSHIP_ID,
          target.document.partitionKey,
        );
        if (
          !latest?.document.membership ||
          latest.document.membership.tenantId !== tenantId ||
          latest.document.membership.username.toLowerCase() !== normalized ||
          (!existing && latest.document.membership.role !== role)
        ) {
          await releaseBusinessMembership(
            tenantId,
            normalized,
            userId,
            reservationState.operationId,
            !existing,
          );
        }
        if (isPreconditionFailed(error)) {
          throw authError(
            409,
            "The user's business assignment changed. Refresh and retry.",
          );
        }
        throw error;
      }
      if (existing && existing.username.toLowerCase() !== normalized) {
        const oldReservation = await readDocument<MembershipReservation>(
          controlContainer(),
          `username_${sha256(existing.username.toLowerCase())}`,
          tenantId,
        );
        if (oldReservation?.document.userId === userId) {
          await releaseBusinessMembership(
            tenantId,
            existing.username,
            userId,
            oldReservation.document.operationId,
            false,
          );
        }
      }
      await syncMembershipReservation(tenantId, userId, normalized, role);
    },
    tenantId,
  );
}

async function approveApplication(
  actor: UserDocument,
  userId: string,
): Promise<AuthActionResult> {
  const target = await findUserById(userId);
  if (!target?.document.application) {
    throw authError(404, "The business application was not found.");
  }
  const app = target.document.application;
  if (app.status === "rejected") {
    throw authError(409, "A rejected application cannot be approved.");
  }
  if (!target.document.emailVerified || target.document.status !== "active") {
    throw authError(409, "The applicant must verify their email before approval.");
  }
  const business = await readBusiness(app.businessId);
  if (
    !business ||
    business.document.status === "rejected" ||
    business.document.status === "disabled"
  ) {
    throw authError(409, "The business application is no longer available.");
  }
  if (
    target.document.membership &&
    target.document.membership.tenantId !== app.businessId
  ) {
    throw authError(409, "The applicant already belongs to another business.");
  }

  const result = await withAudit(
    actor,
    "business-application-approved",
    target.document.userId,
    async () => {
      const username = `owner_${target.document.userId.replace(/-/g, "").slice(0, 10)}`;
      let heldReservation: { operationId: string } | undefined;
      try {
        let latestTarget = await readDocument<UserDocument>(
          controlContainer(),
          ACCOUNT_MEMBERSHIP_ID,
          target.document.partitionKey,
        );
        if (!latestTarget || latestTarget.document.application?.status === "rejected") {
          throw authError(409, "The application is no longer available.");
        }
        if (
          latestTarget.document.membership &&
          (latestTarget.document.membership.tenantId !== app.businessId ||
            latestTarget.document.membership.username !== username ||
            latestTarget.document.membership.role !== "company_admin")
        ) {
          throw authError(409, "The applicant has an incompatible business assignment.");
        }
        if (!latestTarget.document.membership) {
          heldReservation = await reserveBusinessMembership(
            app.businessId,
            target.document.userId,
            username,
            "company_admin",
            true,
          );
          latestTarget = await readDocument<UserDocument>(
            controlContainer(),
            ACCOUNT_MEMBERSHIP_ID,
            target.document.partitionKey,
          );
          if (!latestTarget || latestTarget.document.application?.status === "rejected") {
            throw authError(409, "The application is no longer available.");
          }
          if (
            latestTarget.document.membership &&
            (latestTarget.document.membership.tenantId !== app.businessId ||
              latestTarget.document.membership.username !== username ||
              latestTarget.document.membership.role !== "company_admin")
          ) {
            throw authError(409, "The applicant has an incompatible business assignment.");
          }
        }
        if (!latestTarget.document.membership || latestTarget.document.application?.status !== "approved") {
          const updated: UserDocument = {
            ...latestTarget.document,
            membership: {
              tenantId: app.businessId,
              username,
              role: "company_admin",
            },
            application: { ...app, status: "approved" },
            authVersion: latestTarget.document.membership
              ? latestTarget.document.authVersion
              : latestTarget.document.authVersion + 1,
            updatedAt: new Date().toISOString(),
          };
          await replaceUserWithAdminAudit(
            latestTarget,
            updated,
            actor,
            "business-application-approved",
            app.businessId,
          );
        }
        const latestBusiness = await readBusiness(app.businessId);
        if (
          !latestBusiness ||
          latestBusiness.document.status === "rejected" ||
          latestBusiness.document.status === "disabled"
        ) {
          throw authError(409, "The business application is no longer available.");
        }
        if (latestBusiness.document.status !== "active") {
          await replaceDocument(
            controlContainer(),
            {
              ...latestBusiness.document,
              status: "active",
              updatedAt: new Date().toISOString(),
            },
            latestBusiness.etag,
          );
        }
        return {
          accountKey: target.document.partitionKey,
          email: target.document.email,
          name: target.document.name,
        };
      } catch (error) {
        if (heldReservation) {
          const latestTarget = await readDocument<UserDocument>(
            controlContainer(),
            ACCOUNT_MEMBERSHIP_ID,
            target.document.partitionKey,
          );
          if (
            !latestTarget?.document.membership ||
            latestTarget.document.membership.tenantId !== app.businessId ||
            latestTarget.document.membership.role !== "company_admin"
          ) {
            await releaseBusinessMembership(
              app.businessId,
              `owner_${target.document.userId.replace(/-/g, "").slice(0, 10)}`,
              target.document.userId,
              heldReservation.operationId,
              true,
            );
          }
        }
        throw error;
      }
    },
    app.businessId,
  );
  const notification = makeNotification(
    result.accountKey,
    userId,
    "application-approved",
    decisionEmail(result.email, result.name, true),
  );
  await createDocument(controlContainer(), notification);
  if (!(await deliverNotification(result.accountKey, notification.id))) {
    throw authError(
      503,
      "The application was approved, but its email notification could not be sent.",
    );
  }
  return {
    status: 200,
    body: { message: "Business application approved." },
  };
}

async function rejectApplication(
  actor: UserDocument,
  userId: string,
): Promise<AuthActionResult> {
  const target = await findUserById(userId);
  if (!target?.document.application) {
    throw authError(404, "The business application was not found.");
  }
  const app = target.document.application;
  if (app.status === "approved" || target.document.membership) {
    throw authError(409, "An approved business application cannot be rejected.");
  }
  const result = await withAudit(
    actor,
    "business-application-rejected",
    target.document.userId,
    async () => {
      const latestUser = await readDocument<UserDocument>(
        controlContainer(),
        ACCOUNT_MEMBERSHIP_ID,
        target.document.partitionKey,
      );
      if (!latestUser || latestUser.document.membership) {
        throw authError(409, "The application can no longer be rejected.");
      }
      const updatedUser: UserDocument = {
        ...latestUser.document,
        application: { ...app, status: "rejected" },
        updatedAt: new Date().toISOString(),
      };
      await replaceUserWithAdminAudit(
        latestUser,
        updatedUser,
        actor,
        "business-application-rejected",
        app.businessId,
      );
      const businessState = await readBusiness(app.businessId);
      if (businessState && businessState.document.status === "pending") {
        await replaceDocument(
          controlContainer(),
          {
            ...businessState.document,
            status: "rejected",
            updatedAt: new Date().toISOString(),
          },
          businessState.etag,
        );
      }
      return {
        accountKey: latestUser.document.partitionKey,
        email: latestUser.document.email,
        name: latestUser.document.name,
      };
    },
    app.businessId,
  );
  const notification = makeNotification(
    result.accountKey,
    userId,
    "application-rejected",
    decisionEmail(result.email, result.name, false),
  );
  await createDocument(controlContainer(), notification);
  if (!(await deliverNotification(result.accountKey, notification.id))) {
    throw authError(
      503,
      "The application was rejected, but its email notification could not be sent.",
    );
  }
  return {
    status: 200,
    body: { message: "Business application rejected." },
  };
}

export async function runAuthAction(
  action: AuthAction,
  input: Record<string, unknown>,
  request: Request,
): Promise<AuthActionResult> {
  switch (action) {
    case "register":
      await consumeEmailLimit(action, input.email, 5, 3600);
      return createRegistration(
        input.name as string,
        input.email as string,
        input.password as string,
        input.businessName as string | undefined,
      );
    case "resend-verification":
      await consumeEmailLimit(action, input.email, 3, 3600);
      return resendVerification(input.email as string);
    case "login":
      await consumeEmailLimit(action, input.email, 10, 900);
      return login(input.email as string, input.password as string);
    case "logout":
      return logout(request);
    case "verify":
      return verifyEmail(input.token as string);
    case "request-reset":
      await consumeEmailLimit(action, input.email, 5, 3600);
      return requestPasswordReset(input.email as string);
    case "reset":
      return resetPassword(input.token as string, input.password as string);
    case "mfa-setup":
      return setupMfa(request);
    case "mfa-enable":
      return enableMfa(request, input.code as string);
    case "mfa":
      return completeMfa(request, input.code as string);
    case "recovery":
      return recoverMfa(request, input.code as string);
    default:
      throw authError(404, "This authentication action was not found.");
  }
}

async function consumeEmailLimit(
  action: string,
  email: unknown,
  maximum: number,
  windowSeconds: number,
): Promise<void> {
  if (typeof email !== "string") {
    return;
  }
  await consumeRateLimit(
    `email-${action}`,
    accountPartition(normalizeEmail(email)),
    maximum,
    windowSeconds,
  );
}

export async function runAdminAction(
  action: "approve" | "reject" | "platform-role" | "assign",
  input: Record<string, unknown>,
  request: Request,
): Promise<AuthActionResult> {
  const actor = await startPlatformAction(request);
  if (action === "approve") {
    return approveApplication(actor, input.userId as string);
  }
  if (action === "reject") {
    return rejectApplication(actor, input.userId as string);
  }
  if (action === "platform-role") {
    await setPlatformRole(
      actor,
      input.userId as string,
      input.enabled as boolean,
    );
    return { status: 200, body: { message: "Platform role updated." } };
  }
  await setMembership(
    actor,
    input.userId as string,
    input.tenantId as string,
    input.username as string,
    input.role as "company_admin" | "company_user",
  );
  return { status: 200, body: { message: "Business membership updated." } };
}

export async function listAdminData(
  request: Request,
  usersCursor?: string,
  businessesCursor?: string,
): Promise<{
  users: UserView[];
  businesses: BusinessView[];
  usersCursor?: string;
  businessesCursor?: string;
}> {
  const actor = await startPlatformAction(request);
  return withAudit(
    actor,
    "platform-directory-read",
    "platform-directory",
    async () => {
      const control = controlContainer();
      const [userPage, businessPage] = await Promise.all([
        queryPage<{
          userId: string;
          email: string;
          name: string;
          status: UserDocument["status"];
          platformAdmin: boolean;
          emailVerified: boolean;
          mfaEnabled: boolean;
          membership?: UserDocument["membership"];
          application?: UserDocument["application"];
        }>(
          control,
          "SELECT c.userId, c.email, c.name, c.status, c.platformAdmin, c.emailVerified, c.mfaEnabled, c.membership, c.application FROM c WHERE c.type = @type",
          [{ name: "@type", value: "user" }],
          usersCursor,
          50,
        ),
        queryPage<BusinessDocument>(
          control,
          "SELECT c.id, c.partitionKey, c.type, c.schemaVersion, c.name, c.status, c.memberCount, c.createdAt, c.updatedAt FROM c WHERE c.type = @type",
          [{ name: "@type", value: "business" }],
          businessesCursor,
          50,
        ),
      ]);
      return {
        users: userPage.items.map((user) => ({
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
        })),
        businesses: businessPage.items.map((business) => ({
          id: business.id,
          name: business.name,
          status: business.status,
        })),
        ...(userPage.continuationToken
          ? { usersCursor: userPage.continuationToken }
          : {}),
        ...(businessPage.continuationToken
          ? { businessesCursor: businessPage.continuationToken }
          : {}),
      };
    },
  );
}

export async function authorizePlatformViewer(
  viewer: Viewer | null,
): Promise<void> {
  requirePlatformViewer(viewer);
}

export function getSafeError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof StorageError) {
    if (error.status >= 500) {
      console.error(
        JSON.stringify({
          event: "auth-operation-failed",
          category: "storage",
          status: error.status,
        }),
      );
    }
    return {
      status: error.status,
      message:
        error.status >= 500
          ? "The request could not be completed."
          : error.message,
    };
  }
  if (error instanceof AuthPolicyError) {
    return { status: error.status, message: error.message };
  }
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return { status: error.status, message: error.message };
  }
  console.error(
    JSON.stringify({
      event: "auth-operation-failed",
      category: "internal",
      status: 503,
    }),
  );
  return { status: 503, message: "The request could not be completed." };
}

export function validateAdminCursor(cursor: string | null): string | undefined {
  if (!cursor) {
    return undefined;
  }
  if (cursor.length > 8_000) {
    throw authError(400, "The continuation cursor is invalid.");
  }
  return cursor;
}

export async function logoutCurrentSession(request: Request): Promise<void> {
  const token = requestCookie(request, AUTH_COOKIE_NAME);
  if (!token) {
    return;
  }
  const current = await resolveSessionToken(token);
  if (current) {
    await revokeSession(
      current.session.document.partitionKey,
      current.session.document.id,
    );
  }
}
