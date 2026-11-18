import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AUTH_COOKIE_NAME,
  createSession,
} from "../src/server/auth.ts";
import { accountPartition, sha256 } from "../src/server/auth-crypto.ts";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  queryAllPages,
  readDocument,
  sessionContainer,
} from "../src/server/auth-storage.ts";
import { DATA_RETENTION } from "../src/server/data-retention.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function syntheticUser(email, tenantId, role) {
  const now = new Date().toISOString();
  return {
    id: "user",
    userId: randomUUID(),
    partitionKey: accountPartition(email),
    type: "user",
    schemaVersion: 1,
    email,
    name: "Synthetic Business User",
    status: "active",
    passwordHash: "synthetic-only",
    emailVerified: true,
    platformAdmin: false,
    authVersion: 1,
    createdAt: now,
    updatedAt: now,
    mfaEnabled: false,
    membership: {
      tenantId,
      username: `${role}-${randomUUID().slice(0, 8)}`,
      role,
    },
  };
}

test("business settings pages and APIs enforce tenant roles",
  { skip: !baseUrl }, async () => {
    const tenantId = randomUUID();
    const suffix = randomUUID();
    const admin = syntheticUser(
      `business-admin-${suffix}@example.invalid`,
      tenantId,
      "company_admin",
    );
    const staff = syntheticUser(
      `business-user-${suffix}@example.invalid`,
      tenantId,
      "company_user",
    );
    const sessions = [];
    const partitions = [tenantId, admin.partitionKey, staff.partitionKey];
    const origin = new URL(baseUrl).origin;
    const request = (path, token, options = {}) =>
      fetch(new URL(path, baseUrl), {
        redirect: "manual",
        ...options,
        headers: {
          ...(token ? { cookie: `${AUTH_COOKIE_NAME}=${token}` } : {}),
          ...(options.body
            ? { "Content-Type": "application/json", Origin: origin }
            : {}),
          ...options.headers,
        },
      });
    try {
      await createDocument(controlContainer(), {
        id: tenantId,
        partitionKey: tenantId,
        type: "business",
        schemaVersion: 1,
        name: "Runtime test business",
        status: "active",
        memberCount: 2,
        timezone: "Europe/London",
        currency: "GBP",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await createDocument(controlContainer(), admin);
      await createDocument(controlContainer(), staff);
      await createDocument(controlContainer(), {
        id: "email-index",
        partitionKey: staff.partitionKey,
        type: "email-index",
        schemaVersion: 1,
        normalizedEmail: staff.email,
        userId: staff.userId,
      });
      const adminSession = await createSession(admin, false);
      const staffSession = await createSession(staff, false);
      sessions.push(adminSession.document, staffSession.document);

      const unauthenticated = await request("/settings");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      const legacyInvitation = await request("/invite?token=invalid");
      assert.equal(legacyInvitation.status, 307);
      assert.equal(
        new URL(legacyInvitation.headers.get("location"), baseUrl).pathname,
        "/register",
      );
      assert.equal(
        (await request("/settings", adminSession.token)).status,
        200,
      );
      const companyAdminLanding = await request("/admin", adminSession.token);
      assert.equal(companyAdminLanding.status, 307);
      assert.equal(
        new URL(companyAdminLanding.headers.get("location"), baseUrl).pathname,
        "/account",
      );
      assert.equal(
        (await request("/admin/users", adminSession.token)).status,
        200,
      );
      const staffUsersPage = await request(
        "/admin/users",
        staffSession.token,
      );
      assert.equal(staffUsersPage.status, 307);
      assert.equal(
        new URL(staffUsersPage.headers.get("location"), baseUrl).pathname,
        "/account",
      );

      const companyDirectory = await request(
        "/api/admin",
        adminSession.token,
      );
      assert.equal(companyDirectory.status, 200);
      const companyDirectoryData = await companyDirectory.json();
      assert.deepEqual(
        companyDirectoryData.users.map((user) => user.id).sort(),
        [admin.userId, staff.userId].sort(),
      );
      assert.deepEqual(
        companyDirectoryData.businesses.map((business) => business.id),
        [tenantId],
      );
      assert.equal(
        (await request("/api/admin", staffSession.token)).status,
        403,
      );
      const selfPause = await request(
        "/api/admin/account-status",
        adminSession.token,
        {
          method: "POST",
          body: JSON.stringify({ userId: admin.userId, paused: true }),
        },
      );
      assert.equal(selfPause.status, 409);
      const selfDemotion = await request(
        "/api/admin/assign",
        adminSession.token,
        {
          method: "POST",
          body: JSON.stringify({
            userId: admin.userId,
            tenantId,
            username: admin.membership.username,
            role: "company_user",
          }),
        },
      );
      assert.equal(selfDemotion.status, 409);

      const adminRead = await request("/api/business", adminSession.token);
      assert.equal(adminRead.status, 200);
      assert.equal((await adminRead.json()).business.canManage, true);

      const update = await request("/api/business", adminSession.token, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Updated runtime business",
          timezone: "America/New_York",
          currency: "USD",
          defaultDepositPercentage: 25,
          reminderRules: [
            { channel: "EMAIL", offsetMinutes: 1440 },
            { channel: "SMS", offsetMinutes: 120 },
          ],
        }),
      });
      assert.equal(update.status, 200);

      const tenantInjection = await request(
        "/api/business",
        adminSession.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: "Forbidden",
            timezone: "Europe/London",
            currency: "GBP",
            defaultDepositPercentage: 25,
            reminderRules: [],
            tenantId: randomUUID(),
          }),
        },
      );
      assert.equal(tenantInjection.status, 400);

      const staffRead = await request("/api/business", staffSession.token);
      assert.equal(staffRead.status, 200);
      const staffData = await staffRead.json();
      assert.equal(staffData.business.name, "Updated runtime business");
      assert.deepEqual(
        staffData.business.reminderRules.map(
          ({ channel, offsetMinutes }) => ({ channel, offsetMinutes }),
        ),
        [
          { channel: "EMAIL", offsetMinutes: 1440 },
          { channel: "SMS", offsetMinutes: 120 },
        ],
      );
      assert.equal(staffData.business.canManage, false);
      assert.deepEqual(staffData.invitations, []);

      const staffUpdate = await request("/api/business", staffSession.token, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Forbidden",
          timezone: "Europe/London",
          currency: "GBP",
          defaultDepositPercentage: 25,
          reminderRules: [],
        }),
      });
      assert.equal(staffUpdate.status, 403);

      const wrongEmail = `wrong-${suffix}@example.invalid`;
      const invitationId = `invitation_${sha256(wrongEmail)}`;
      const notificationId = `notification_${randomUUID()}`;
      await createDocument(controlContainer(), {
        id: invitationId,
        partitionKey: tenantId,
        type: "business-invitation",
        schemaVersion: 1,
        email: wrongEmail,
        role: "company_user",
        status: "pending",
        tokenHash: sha256("synthetic-invitation-token"),
        invitedByUserId: admin.userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await createDocument(controlContainer(), {
        id: notificationId,
        partitionKey: tenantId,
        type: "notification",
        schemaVersion: 1,
        userId: admin.userId,
        event: "business-invitation",
        relatedId: invitationId,
        status: "failed",
        createdAt: new Date().toISOString(),
      });
      const staffDelete = await request(
        "/api/business/invitations",
        staffSession.token,
        {
          method: "DELETE",
          body: JSON.stringify({ email: wrongEmail }),
        },
      );
      assert.equal(staffDelete.status, 403);
      const adminDelete = await request(
        "/api/business/invitations",
        adminSession.token,
        {
          method: "DELETE",
          body: JSON.stringify({ email: wrongEmail }),
        },
      );
      assert.equal(adminDelete.status, 200);
      assert.equal(
        await readDocument(controlContainer(), invitationId, tenantId),
        null,
      );
      assert.equal(
        await readDocument(controlContainer(), notificationId, tenantId),
        null,
      );

      const privilegedInvite = await request(
        "/api/business/invitations",
        adminSession.token,
        {
          method: "POST",
          body: JSON.stringify({
            email: `invite-${suffix}@example.invalid`,
            role: "company_admin",
          }),
        },
      );
      assert.equal(privilegedInvite.status, 400);

      const invalidAcceptance = await request(
        "/api/business/invitations/accept",
        staffSession.token,
        {
          method: "POST",
          body: JSON.stringify({ token: "x".repeat(80) }),
        },
      );
      assert.equal(invalidAcceptance.status, 400);

      const roleUpdate = await request(
        "/api/admin/assign",
        adminSession.token,
        {
          method: "POST",
          body: JSON.stringify({
            userId: staff.userId,
            tenantId,
            username: staff.membership.username,
            role: "company_admin",
          }),
        },
      );
      assert.equal(roleUpdate.status, 200);
      assert.equal(
        (
          await readDocument(
            controlContainer(),
            "user",
            staff.partitionKey,
          )
        ).document.membership.role,
        "company_admin",
      );
      const deleteStaff = await request(
        "/api/admin/delete-user",
        adminSession.token,
        {
          method: "POST",
          body: JSON.stringify({ userId: staff.userId }),
        },
      );
      assert.equal(deleteStaff.status, 200);
      const deletedStaff = await readDocument(
        controlContainer(),
        "user",
        staff.partitionKey,
      );
      assert.equal(deletedStaff.document.status, "deleted");
      assert.equal(
        deletedStaff.document.ttl,
        DATA_RETENTION.deletedAccountTombstoneSeconds,
      );
      assert.equal(
        await readDocument(
          controlContainer(),
          "email-index",
          staff.partitionKey,
        ),
        null,
      );
    } finally {
      let cleanupFailed = false;
      for (const session of sessions) {
        try {
          await deleteDocument(
            sessionContainer(),
            session.id,
            session.partitionKey,
          );
        } catch {
          cleanupFailed = true;
        }
      }
      for (const partitionKey of partitions) {
        const documents = await queryAllPages(
          controlContainer(),
          "SELECT c.id, c.partitionKey FROM c WHERE c.partitionKey = @partitionKey",
          [{ name: "@partitionKey", value: partitionKey }],
          100,
          500,
        );
        for (const document of documents) {
          await deleteDocument(
            controlContainer(),
            document.id,
            document.partitionKey,
          );
        }
      }
      if (cleanupFailed) {
        throw new Error("Synthetic session cleanup failed.");
      }
    }
  });
