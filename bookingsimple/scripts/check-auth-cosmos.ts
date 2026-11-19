import "server-only";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accountPartition, encryptJson, sha256 } from "../src/server/auth-crypto";
import {
  AUTH_COOKIE_NAME,
  createSession,
  getViewerForToken,
  resolveSessionToken,
  type UserDocument,
} from "../src/server/auth";
import { TOTP } from "otpauth";
import { claimBootstrapLock } from "../src/server/bootstrap-lock";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  isConflict,
  isPreconditionFailed,
  queryAllPages,
  readDocument,
  replaceDocument,
  sessionContainer,
  throttleContainer,
} from "../src/server/auth-storage";
import {
  acceptBusinessInvitation,
  listAdminData,
  replaceUserWithAdminAudit,
  runAdminAction,
  runAuthAction,
} from "../src/server/auth-service";
import { createTotp } from "../src/server/auth-totp";
import {
  assertTenantAccess,
  requireCompanyAdmin,
  resolveTenantContext,
} from "../src/server/tenant-context";
import {
  createBusinessInvitation,
  deleteBusinessInvitation,
  getBusinessSetup,
  updateBusinessSettings,
} from "../src/server/business-service";

const createdControlPartitions = new Set<string>();
const createdSessions: { id: string; partitionKey: string }[] = [];
const createdThrottleIds = new Set<string>();
const runId = randomUUID();
const emailSuffix = `${runId}@example.invalid`;
let currentCheck = "initialization";

function syntheticUser(
  email: string,
  options: Partial<UserDocument> = {},
): UserDocument {
  const partitionKey = accountPartition(email);
  createdControlPartitions.add(partitionKey);
  return {
    id: "user",
    userId: randomUUID(),
    partitionKey,
    type: "user",
    schemaVersion: 1,
    email,
    name: "Synthetic Auth Test",
    status: "active",
    passwordHash: "synthetic-only",
    emailVerified: true,
    platformAdmin: false,
    authVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mfaEnabled: false,
    ...options,
  };
}

async function seedUser(document: UserDocument): Promise<void> {
  const control = controlContainer();
  await createDocument(control, document);
  await createDocument(control, {
    id: "email-index",
    partitionKey: document.partitionKey,
    type: "email-index",
    schemaVersion: 1,
    normalizedEmail: document.email,
    userId: document.userId,
  });
}

function trackThrottle(scope: string, key: string): void {
  createdThrottleIds.add(`${scope}_${sha256(`${scope}\n${key}`)}`);
}

async function expectStatus(
  operation: () => Promise<unknown>,
  status: number,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert.equal(
      error && typeof error === "object" && "status" in error
        ? (error as { status: number }).status
        : error && typeof error === "object" && "code" in error
          ? (error as { code: number }).code
          : undefined,
      status,
    );
    return;
  }
  assert.fail(`Expected the operation to fail with status ${status}.`);
}

async function run() {
  const control = controlContainer();
  const actor = syntheticUser(`platform-${emailSuffix}`, {
    platformAdmin: true,
  });
  const noMfaTarget = syntheticUser(`no-mfa-${emailSuffix}`);
  const roleTarget = syntheticUser(`role-target-${emailSuffix}`, {
    mfaEnabled: true,
    mfaSecret: encryptJson("JBSWY3DPEHPK3PXP", "AUTH_MFA_ENCRYPTION_KEY"),
    lastTotpStep: 10,
  });
  const assignedTarget = syntheticUser(`assigned-${emailSuffix}`, {
    membership: {
      tenantId: randomUUID(),
      username: "existing",
      role: "company_user",
    },
  });
  const firstUser = syntheticUser(`first-${emailSuffix}`);
  const secondUser = syntheticUser(`second-${emailSuffix}`);
  const atomicTarget = syntheticUser(`atomic-target-${emailSuffix}`);
  const unverifiedTarget = syntheticUser(`unverified-${emailSuffix}`, {
    status: "pending",
    emailVerified: false,
  });
  for (const user of [actor, noMfaTarget, roleTarget, assignedTarget, firstUser, secondUser]) {
    await seedUser(user);
  }
  await seedUser(atomicTarget);
  await seedUser(unverifiedTarget);

  const duplicateIndex = {
    id: "email-index",
    partitionKey: actor.partitionKey,
    type: "email-index",
    schemaVersion: 1 as const,
    normalizedEmail: actor.email,
    userId: actor.userId,
  };
  try {
    await createDocument(control, duplicateIndex);
    assert.fail("A duplicate email-index item was created.");
  } catch (error) {
    assert.equal(isConflict(error), true);
  }

  const tenantId = randomUUID();
  createdControlPartitions.add(tenantId);
  await createDocument(control, {
    id: tenantId,
    partitionKey: tenantId,
    type: "business",
    schemaVersion: 1,
    name: "Synthetic test business",
    status: "active",
    memberCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const bootstrapPartition = `bootstrap-test_${runId}`;
  createdControlPartitions.add(bootstrapPartition);
  const firstClaim = await claimBootstrapLock(
    actor.userId,
    sha256(`test-only-${runId}`),
    `bootstrap-test_${runId}`,
    bootstrapPartition,
  );
  assert.equal(firstClaim.document.userId, actor.userId);
  await assert.rejects(() =>
    claimBootstrapLock(
      noMfaTarget.userId,
      sha256(`test-only-${runId}`),
      `bootstrap-test_${runId}`,
      bootstrapPartition,
    ),
  );

  const actorSession = await createSession(actor, false);
  createdSessions.push({
    id: actorSession.document.id,
    partitionKey: actor.partitionKey,
  });
  const request = new Request("https://bookingsimple.invalid/api/admin", {
    headers: {
      cookie: `${AUTH_COOKIE_NAME}=${actorSession.token}`,
    },
  });

  const ordinarySession = await createSession(noMfaTarget, false);
  createdSessions.push({
    id: ordinarySession.document.id,
    partitionKey: noMfaTarget.partitionKey,
  });
  const ordinaryRequest = new Request("https://bookingsimple.invalid/api/admin", {
    headers: { cookie: `${AUTH_COOKIE_NAME}=${ordinarySession.token}` },
  });
  await expectStatus(() => listAdminData(ordinaryRequest), 403);
  await expectStatus(
    () => runAdminAction("platform-role", { userId: unverifiedTarget.userId, enabled: true }, request),
    404,
  );
  await runAdminAction(
    "platform-role",
    { userId: noMfaTarget.userId, enabled: true },
    request,
  );
  const noMfaRole = await readDocument<UserDocument>(
    control,
    "user",
    noMfaTarget.partitionKey,
  );
  assert.equal(noMfaRole?.document.platformAdmin, true);

  await expectStatus(
    () =>
      runAdminAction(
        "assign",
        {
          userId: assignedTarget.userId,
          tenantId,
          username: "moved",
          role: "company_user",
        },
        request,
      ),
    409,
  );
  const unchangedMembership = await readDocument<UserDocument>(
    control,
    "user",
    assignedTarget.partitionKey,
  );
  assert.notEqual(unchangedMembership?.document.membership?.tenantId, tenantId);
  assert.equal(await resolveTenantContext(assignedTarget), null);

  const preAssignmentSession = await createSession(firstUser, false);
  createdSessions.push({
    id: preAssignmentSession.document.id,
    partitionKey: firstUser.partitionKey,
  });
  await runAdminAction(
    "assign",
    {
      userId: firstUser.userId,
      tenantId,
      username: "unique-user",
      role: "company_admin",
    },
    request,
  );
  assert.equal(await resolveSessionToken(preAssignmentSession.token), null);
  const assignedCompanyAdmin = await readDocument<UserDocument>(
    control,
    "user",
    firstUser.partitionKey,
  );
  assert.equal(assignedCompanyAdmin?.document.membership?.role, "company_admin");
  assert.equal(assignedCompanyAdmin?.document.platformAdmin, false);
  assert.ok(assignedCompanyAdmin);
  const tenantContext = await resolveTenantContext(
    assignedCompanyAdmin.document,
  );
  assert.deepEqual(tenantContext, {
    tenantId,
    businessName: "Synthetic test business",
    username: "unique-user",
    role: "company_admin",
  });
  assert.ok(tenantContext);
  requireCompanyAdmin(tenantContext);
  assertTenantAccess(tenantContext, tenantId);
  assert.throws(
    () => assertTenantAccess(tenantContext, randomUUID()),
    { status: 403 },
  );
  const companyAdminSession = await createSession(
    assignedCompanyAdmin.document,
    false,
  );
  createdSessions.push({
    id: companyAdminSession.document.id,
    partitionKey: firstUser.partitionKey,
  });
  const companyAdminViewer = await getViewerForToken(
    companyAdminSession.token,
  );
  assert.deepEqual(companyAdminViewer?.tenant, tenantContext);
  const companyAdminRequest = new Request(
    "https://bookingsimple.invalid/api/admin",
    {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${companyAdminSession.token}`,
      },
    },
  );
  await expectStatus(() => listAdminData(companyAdminRequest), 403);
  await expectStatus(
    () =>
      runAdminAction(
        "platform-role",
        { userId: secondUser.userId, enabled: true },
        companyAdminRequest,
      ),
    403,
  );

  currentCheck = "business-settings-read";
  const initialBusinessSetup = await getBusinessSetup(companyAdminRequest);
  assert.deepEqual(
      {
        name: initialBusinessSetup.business.name,
        timezone: initialBusinessSetup.business.timezone,
        country: initialBusinessSetup.business.country,
        currency: initialBusinessSetup.business.currency,
        defaultDepositPercentage:
          initialBusinessSetup.business.defaultDepositPercentage,
        reminderRules: initialBusinessSetup.business.reminderRules,
        canManage: initialBusinessSetup.business.canManage,
      },
      {
        name: "Synthetic test business",
        timezone: "Europe/London",
        country: "GB",
        currency: "GBP",
        defaultDepositPercentage: 0,
        reminderRules: [],
        canManage: true,
      },
  );
  currentCheck = "business-settings-update";
  const updatedBusiness = await updateBusinessSettings(
      companyAdminRequest,
      {
        name: "Updated synthetic business",
        timezone: "America/New_York",
        country: "US",
        currency: "USD",
        defaultDepositPercentage: 25,
        reminderRules: [
          {
            id: "email-1440",
            channel: "EMAIL",
            offsetMinutes: 1440,
          },
        ],
      },
  );
  assert.equal(updatedBusiness.name, "Updated synthetic business");
  assert.equal(updatedBusiness.timezone, "America/New_York");
  assert.equal(updatedBusiness.country, "US");
  assert.equal(updatedBusiness.currency, "USD");
  assert.equal(updatedBusiness.defaultDepositPercentage, 25);
  assert.equal(updatedBusiness.reminderRules.length, 1);

  currentCheck = "business-invitation-create";
  const invitationMessages: {
      TextBody: string;
  }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
      if (String(url) !== "https://api.postmarkapp.com/email") {
        return originalFetch(url, options);
      }
      invitationMessages.push(JSON.parse(String(options?.body)));
      return Response.json({ ErrorCode: 0 });
  };
  try {
      await createBusinessInvitation(companyAdminRequest, {
        email: secondUser.email,
      });
  } finally {
      globalThis.fetch = originalFetch;
  }
  const invitationLink = invitationMessages[0]?.TextBody.match(
      /https?:\/\/\S+/,
  )?.[0];
  assert.ok(invitationLink);
  const invitationToken = new URL(invitationLink).searchParams.get("token");
  assert.ok(invitationToken);
  const invitedSetup = await getBusinessSetup(companyAdminRequest);
  assert.equal(invitedSetup.invitations.length, 1);
  assert.equal(invitedSetup.invitations[0].email, secondUser.email);
  assert.equal(invitedSetup.invitations[0].status, "pending");

  currentCheck = "business-invitation-wrong-account";
  assert.ok(noMfaRole);
  const wrongAccountSession = await createSession(
    noMfaRole.document,
    false,
  );
  createdSessions.push({
      id: wrongAccountSession.document.id,
      partitionKey: noMfaTarget.partitionKey,
  });
  const wrongAccountRequest = new Request(
      "https://bookingsimple.invalid/api/business/invitations/accept",
      {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${wrongAccountSession.token}`,
        },
      },
  );
  try {
      await acceptBusinessInvitation(wrongAccountRequest, invitationToken);
      assert.fail("The wrong account accepted a business invitation.");
  } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number(error.status)
          : error && typeof error === "object" && "code" in error
            ? Number(error.code)
            : 0;
      currentCheck = `business-invitation-wrong-account-status-${status}`;
      assert.equal(status, 403);
  }

  currentCheck = "business-invitation-accept";
  const invitedSession = await createSession(secondUser, false);
  createdSessions.push({
      id: invitedSession.document.id,
      partitionKey: secondUser.partitionKey,
  });
  const invitedRequest = new Request(
      "https://bookingsimple.invalid/api/business/invitations/accept",
      {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${invitedSession.token}`,
        },
      },
  );
  await acceptBusinessInvitation(invitedRequest, invitationToken);
  assert.equal(await resolveSessionToken(invitedSession.token), null);
  const invitedUser = await readDocument<UserDocument>(
      control,
      "user",
      secondUser.partitionKey,
  );
  assert.equal(invitedUser?.document.membership?.tenantId, tenantId);
  assert.equal(invitedUser?.document.membership?.role, "company_user");
  assert.ok(invitedUser);
  const staffSession = await createSession(invitedUser.document, false);
  createdSessions.push({
      id: staffSession.document.id,
      partitionKey: secondUser.partitionKey,
  });
  const staffRequest = new Request(
      "https://bookingsimple.invalid/api/business",
      {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${staffSession.token}`,
        },
      },
  );
  const staffSetup = await getBusinessSetup(staffRequest);
  assert.equal(staffSetup.business.canManage, false);
  assert.equal(staffSetup.business.name, "Updated synthetic business");
  assert.deepEqual(staffSetup.invitations, []);
  await expectStatus(
      () =>
        updateBusinessSettings(staffRequest, {
          name: "Forbidden update",
          timezone: "Europe/London",
          country: "GB",
          currency: "GBP",
          defaultDepositPercentage: 50,
          reminderRules: [],
        }),
      403,
  );

  currentCheck = "business-invitation-delete";
  const wrongEmail = `wrong-${emailSuffix}`;
  const originalDeleteFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
      if (String(url) !== "https://api.postmarkapp.com/email") {
        return originalDeleteFetch(url, options);
      }
      return new Response("{}", { status: 503 });
  };
  try {
      await expectStatus(
        () =>
          createBusinessInvitation(companyAdminRequest, {
            email: wrongEmail,
          }),
        503,
      );
  } finally {
      globalThis.fetch = originalDeleteFetch;
  }
  const wrongInvitationId = `invitation_${sha256(wrongEmail)}`;
  assert.ok(
      await readDocument(control, wrongInvitationId, tenantId),
  );
  await deleteBusinessInvitation(companyAdminRequest, {
      email: wrongEmail,
  });
  assert.equal(
      await readDocument(control, wrongInvitationId, tenantId),
      null,
  );
  const retryableWrongEmailNotifications = await queryAllPages<{ id: string }>(
      control,
      "SELECT c.id FROM c WHERE c.partitionKey = @tenantId AND c.type = @type AND c.relatedId = @relatedId AND c.status != @sent",
      [
        { name: "@tenantId", value: tenantId },
        { name: "@type", value: "notification" },
        { name: "@relatedId", value: wrongInvitationId },
        { name: "@sent", value: "sent" },
      ],
  );
  assert.deepEqual(retryableWrongEmailNotifications, []);

  currentCheck = "remaining-auth-checks";
  const membershipAudits = await queryAllPages<{
    actorUserId: string;
    action: string;
    affectedUserId: string;
    affectedTenantId?: string;
  }>(
    control,
    "SELECT c.actorUserId, c.action, c.affectedUserId, c.affectedTenantId FROM c WHERE c.partitionKey = @partitionKey AND c.type = @type",
    [
      { name: "@partitionKey", value: firstUser.partitionKey },
      { name: "@type", value: "affected-account-audit" },
    ],
  );
  assert.deepEqual(membershipAudits, [
    {
      actorUserId: actor.userId,
      action: "business-user-assigned",
      affectedUserId: firstUser.userId,
      affectedTenantId: tenantId,
    },
  ]);
  await expectStatus(
    () =>
      runAdminAction(
        "assign",
        {
          userId: secondUser.userId,
          tenantId,
          username: "UNIQUE-USER",
          role: "company_user",
        },
        request,
      ),
    409,
  );

  const oldRoleSession = await createSession(roleTarget, false);
  createdSessions.push({
    id: oldRoleSession.document.id,
    partitionKey: roleTarget.partitionKey,
  });
  await runAdminAction(
    "platform-role",
    { userId: roleTarget.userId, enabled: true },
    request,
  );
  assert.equal(await resolveSessionToken(oldRoleSession.token), null);
  const grantedRole = await readDocument<UserDocument>(
    control,
    "user",
    roleTarget.partitionKey,
  );
  assert.equal(grantedRole?.document.platformAdmin, true);
  const roleAudits = await queryAllPages<{
    actorUserId: string;
    action: string;
    affectedUserId: string;
    outcome: string;
  }>(
    control,
    "SELECT c.actorUserId, c.action, c.affectedUserId, c.outcome FROM c WHERE c.partitionKey = @partitionKey AND c.type = @type",
    [
      { name: "@partitionKey", value: roleTarget.partitionKey },
      { name: "@type", value: "affected-account-audit" },
    ],
  );
  assert.equal(roleAudits.length, 1);
  assert.deepEqual(
    {
      actorUserId: roleAudits[0].actorUserId,
      action: roleAudits[0].action,
      affectedUserId: roleAudits[0].affectedUserId,
      outcome: roleAudits[0].outcome,
    },
    {
      actorUserId: actor.userId,
      action: "platform-role-granted",
      affectedUserId: roleTarget.userId,
      outcome: "succeeded",
    },
  );
  await listAdminData(request);
  const actorAudits = await queryAllPages<{
    action: string;
    outcome: string;
    affectedUserId: string;
    usersCursor?: string;
    businessesCursor?: string;
  }>(
    control,
    "SELECT c.action, c.outcome, c.affectedUserId, c.usersCursor, c.businessesCursor FROM c WHERE c.partitionKey = @partitionKey AND c.type = @type",
    [
      { name: "@partitionKey", value: actor.partitionKey },
      { name: "@type", value: "platform-admin-audit" },
    ],
  );
  assert.equal(
    actorAudits.some(
      (audit) =>
        audit.action === "platform-role-granted" &&
        audit.outcome === "succeeded" &&
        audit.affectedUserId === roleTarget.userId,
    ),
    true,
  );
  const directoryReadAudit = actorAudits.find(
    (audit) => audit.action === "platform-directory-read",
  );
  assert.equal(directoryReadAudit?.outcome, "succeeded");
  assert.equal(directoryReadAudit?.affectedUserId, "platform-directory");
  assert.equal(directoryReadAudit?.usersCursor, undefined);
  assert.equal(directoryReadAudit?.businessesCursor, undefined);

  const staleTarget = await readDocument<UserDocument>(
    control,
    "user",
    atomicTarget.partitionKey,
  );
  assert.ok(staleTarget);
  await replaceDocument(
    control,
    {
      ...staleTarget.document,
      name: "Synthetic concurrent update",
      updatedAt: new Date().toISOString(),
    },
    staleTarget.etag,
  );
  await expectStatus(
    () =>
      replaceUserWithAdminAudit(
        staleTarget,
        {
          ...staleTarget.document,
          name: "Must not commit",
          updatedAt: new Date().toISOString(),
        },
        actor,
        "synthetic-atomic-failure",
      ),
    409,
  );
  const unchangedTarget = await readDocument<UserDocument>(
    control,
    "user",
    atomicTarget.partitionKey,
  );
  assert.equal(unchangedTarget?.document.name, "Synthetic concurrent update");
  const failedAudits = await queryAllPages<{ id: string }>(
    control,
    "SELECT c.id FROM c WHERE c.partitionKey = @partitionKey AND c.type = @type AND c.action = @action",
    [
      { name: "@partitionKey", value: atomicTarget.partitionKey },
      { name: "@type", value: "affected-account-audit" },
      { name: "@action", value: "synthetic-atomic-failure" },
    ],
  );
  assert.equal(failedAudits.length, 0);

  const challengeEmail = `mfa-limit-${emailSuffix}`;
  const challengeUser = syntheticUser(challengeEmail, {
    mfaEnabled: true,
    mfaSecret: encryptJson("JBSWY3DPEHPK3PXP", "AUTH_MFA_ENCRYPTION_KEY"),
    lastTotpStep:
      TOTP.counter({ timestamp: Date.now(), period: 30 }) + 2,
  });
  await seedUser(challengeUser);
  const staleTotpCode = createTotp(
    "JBSWY3DPEHPK3PXP",
    challengeEmail,
  ).generate();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const challengeSession = await createSession(challengeUser, false);
    createdSessions.push({
      id: challengeSession.document.id,
      partitionKey: challengeUser.partitionKey,
    });
    trackThrottle("mfa-challenge", challengeUser.partitionKey);
    trackThrottle(
      "mfa-challenge",
      `${challengeUser.partitionKey}:${challengeSession.document.id}`,
    );
    const challengeRequest = new Request(
      "https://bookingsimple.invalid/api/auth/mfa",
      {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${challengeSession.token}`,
        },
      },
    );
    await expectStatus(
      () =>
        runAuthAction(
          "mfa",
          { code: staleTotpCode },
          challengeRequest,
        ),
      401,
    );
  }
  const overflowSession = await createSession(challengeUser, false);
  createdSessions.push({
    id: overflowSession.document.id,
    partitionKey: challengeUser.partitionKey,
  });
  const overflowRequest = new Request(
    "https://bookingsimple.invalid/api/auth/mfa",
    {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${overflowSession.token}`,
      },
    },
  );
  await expectStatus(
    () =>
      runAuthAction("mfa", { code: staleTotpCode }, overflowRequest),
    429,
  );

  const raceUser = syntheticUser(`race-${emailSuffix}`, {
    mfaEnabled: true,
    mfaSecret: encryptJson("JBSWY3DPEHPK3PXP", "AUTH_MFA_ENCRYPTION_KEY"),
    lastTotpStep: 100,
    backupCodeHashes: [sha256("one-time-backup")],
  });
  await seedUser(raceUser);
  const raceRead = await readDocument<UserDocument>(
    control,
    "user",
    raceUser.partitionKey,
  );
  assert.ok(raceRead);
  const totpUpdate = {
    ...raceRead.document,
    lastTotpStep: 101,
    updatedAt: new Date().toISOString(),
  };
  const totpResults = await Promise.allSettled([
    replaceDocument(control, totpUpdate, raceRead.etag),
    replaceDocument(control, totpUpdate, raceRead.etag),
  ]);
  assert.equal(totpResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    totpResults.some(
      (result) =>
        result.status === "rejected" && isPreconditionFailed(result.reason),
    ),
    true,
  );

  const backupRead = await readDocument<UserDocument>(
    control,
    "user",
    raceUser.partitionKey,
  );
  assert.ok(backupRead);
  const consumeBackup = {
    ...backupRead.document,
    backupCodeHashes: [],
    updatedAt: new Date().toISOString(),
  };
  const backupResults = await Promise.allSettled([
    replaceDocument(control, consumeBackup, backupRead.etag),
    replaceDocument(control, consumeBackup, backupRead.etag),
  ]);
  assert.equal(backupResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    backupResults.some(
      (result) =>
        result.status === "rejected" && isPreconditionFailed(result.reason),
    ),
    true,
  );

  console.log(
    "Synthetic Cosmos auth checks passed: duplicate email, bootstrap lock, password-only admin role grant, active tenant-context resolution, cross-tenant denial, tenant transfer denial, business settings authorization, invitation acceptance and deletion, username uniqueness, session invalidation, atomic target audits, directory-read audit, cross-session MFA exhaustion, and one-time CAS.",
  );
}

async function cleanup() {
  let failed = false;
  for (const session of createdSessions) {
    try {
      await deleteDocument(
        sessionContainer(),
        session.id,
        session.partitionKey,
      );
    } catch {
      failed = true;
    }
  }
  for (const id of createdThrottleIds) {
    try {
      await deleteDocument(throttleContainer(), id, id);
    } catch {
      failed = true;
    }
  }
  for (const partitionKey of createdControlPartitions) {
    try {
      const records = await queryAllPages<{ id: string; partitionKey: string }>(
        controlContainer(),
        "SELECT c.id, c.partitionKey FROM c WHERE c.partitionKey = @partitionKey",
        [{ name: "@partitionKey", value: partitionKey }],
        100,
        500,
      );
      for (const record of records) {
        await deleteDocument(
          controlContainer(),
          record.id,
          record.partitionKey,
        );
      }
    } catch {
      failed = true;
    }
  }
  if (failed) {
    throw new Error("One or more synthetic records could not be removed.");
  }
}

run()
  .catch(() => {
    console.error(
      `Synthetic Cosmos auth checks failed during ${currentCheck}. No test emails, credentials, or personal data were printed.`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch {
      console.error("Synthetic Cosmos cleanup failed; inspect only the synthetic test ID.");
      process.exitCode = 1;
    }
  });
