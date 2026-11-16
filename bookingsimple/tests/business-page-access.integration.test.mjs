import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AUTH_COOKIE_NAME,
  createSession,
} from "../src/server/auth.ts";
import { accountPartition } from "../src/server/auth-crypto.ts";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  queryAllPages,
  sessionContainer,
} from "../src/server/auth-storage.ts";

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
      const adminSession = await createSession(admin, false);
      const staffSession = await createSession(staff, false);
      sessions.push(adminSession.document, staffSession.document);

      const unauthenticated = await request("/settings");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      assert.equal((await request("/invite?token=invalid")).status, 200);
      assert.equal(
        (await request("/settings", adminSession.token)).status,
        200,
      );

      const adminRead = await request("/api/business", adminSession.token);
      assert.equal(adminRead.status, 200);
      assert.equal((await adminRead.json()).business.canManage, true);

      const update = await request("/api/business", adminSession.token, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Updated runtime business",
          timezone: "America/New_York",
          currency: "USD",
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
            tenantId: randomUUID(),
          }),
        },
      );
      assert.equal(tenantInjection.status, 400);

      const staffRead = await request("/api/business", staffSession.token);
      assert.equal(staffRead.status, 200);
      const staffData = await staffRead.json();
      assert.equal(staffData.business.name, "Updated runtime business");
      assert.equal(staffData.business.canManage, false);
      assert.deepEqual(staffData.invitations, []);

      const staffUpdate = await request("/api/business", staffSession.token, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Forbidden",
          timezone: "Europe/London",
          currency: "GBP",
        }),
      });
      assert.equal(staffUpdate.status, 403);

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
