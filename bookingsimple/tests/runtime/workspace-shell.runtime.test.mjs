import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AUTH_COOKIE_NAME,
  createSession,
} from "../../src/server/auth.ts";
import { accountPartition } from "../../src/server/auth-crypto.ts";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  queryAllPages,
  sessionContainer,
} from "../../src/server/auth-storage.ts";

const baseUrl =
  process.env.RUNTIME_TEST_BASE_URL ?? "http://localhost:3100";

test("workspace routes share persistent role-aware navigation", async () => {
  const tenantId = randomUUID();
  const email = `workspace-shell-${randomUUID()}@example.invalid`;
  const partitionKey = accountPartition(email);
  const now = new Date().toISOString();
  const user = {
    id: "user",
    userId: randomUUID(),
    partitionKey,
    type: "user",
    schemaVersion: 1,
    email,
    name: "Workspace Shell Test",
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
      username: `company-admin-${randomUUID().slice(0, 8)}`,
      role: "company_admin",
    },
  };
  let session;

  try {
    await createDocument(controlContainer(), {
      id: tenantId,
      partitionKey: tenantId,
      type: "business",
      schemaVersion: 1,
      name: "Workspace shell runtime business",
      status: "active",
      memberCount: 1,
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 0,
      reminderRules: [],
      createdAt: now,
      updatedAt: now,
    });
    await createDocument(controlContainer(), user);
    session = await createSession(user, false);
    const headers = {
      cookie: `${AUTH_COOKIE_NAME}=${session.token}`,
    };

    const customers = await fetch(new URL("/customers", baseUrl), { headers });
    assert.equal(customers.status, 200);
    const customersHtml = await customers.text();
    assert.match(customersHtml, /id="workspace-navigation"/);
    assert.match(customersHtml, />Dashboard</);
    assert.match(customersHtml, />Inbox</);
    assert.match(customersHtml, />Customers</);
    assert.match(customersHtml, />Bookings</);
    assert.match(customersHtml, />Services</);
    assert.match(customersHtml, />Business settings</);
    assert.match(customersHtml, />Company users</);
    assert.match(customersHtml, />My account</);
    assert.match(customersHtml, /<h1 id="account-title">Customers<\/h1>/);
    assert.match(
      customersHtml,
      /aria-current="page"[^>]*href="\/customers"/,
    );
    assert.doesNotMatch(customersHtml, /Back to workspace/);

    const settings = await fetch(new URL("/settings", baseUrl), { headers });
    assert.equal(settings.status, 200);
    const settingsHtml = await settings.text();
    assert.match(settingsHtml, /id="workspace-navigation"/);
    assert.match(
      settingsHtml,
      /aria-current="page"[^>]*href="\/settings"/,
    );
    assert.doesNotMatch(settingsHtml, /Back to workspace/);
  } finally {
    if (session) {
      await deleteDocument(
        sessionContainer(),
        session.document.id,
        session.document.partitionKey,
      );
    }
    for (const cleanupPartition of [tenantId, partitionKey]) {
      const documents = await queryAllPages(
        controlContainer(),
        "SELECT c.id, c.partitionKey FROM c WHERE c.partitionKey = @partitionKey",
        [{ name: "@partitionKey", value: cleanupPartition }],
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
  }
});
