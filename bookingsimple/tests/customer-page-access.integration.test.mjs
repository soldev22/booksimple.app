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
  sessionContainer,
} from "../src/server/auth-storage.ts";
import { customerContainer } from "../src/server/customer-storage.ts";

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
    name: "Synthetic Customer Manager",
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

test(
  "customer APIs enforce tenant isolation and lifecycle permissions",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const suffix = randomUUID();
    const adminA = syntheticUser(
      `customer-admin-a-${suffix}@example.invalid`,
      tenantA,
      "company_admin",
    );
    const staffA = syntheticUser(
      `customer-staff-a-${suffix}@example.invalid`,
      tenantA,
      "company_user",
    );
    const staffB = syntheticUser(
      `customer-staff-b-${suffix}@example.invalid`,
      tenantB,
      "company_user",
    );
    const users = [adminA, staffA, staffB];
    const sessions = [];
    const customerIds = new Map([
      [tenantA, new Set()],
      [tenantB, new Set()],
    ]);
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
      for (const [tenantId, name] of [
        [tenantA, "Customer test company A"],
        [tenantB, "Customer test company B"],
      ]) {
        await createDocument(controlContainer(), {
          id: tenantId,
          partitionKey: tenantId,
          type: "business",
          schemaVersion: 1,
          name,
          status: "active",
          memberCount: tenantId === tenantA ? 2 : 1,
          timezone: "Europe/London",
          currency: "GBP",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [adminASession, staffASession, staffBSession] = sessions;

      const unauthenticated = await request("/customers");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      assert.equal((await request("/customers", staffASession.token)).status, 200);

      const injectedTenant = await request(
        "/api/customers",
        staffASession.token,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Injected",
            email: "",
            phone: "",
            tenantId: tenantB,
          }),
        },
      );
      assert.equal(injectedTenant.status, 400);

      const createA = await request("/api/customers", staffASession.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Alex A",
          email: `shared-${suffix}@example.invalid`,
          phone: "+44 7700 900123",
        }),
      });
      assert.equal(createA.status, 201);
      const customerA = (await createA.json()).customer;
      customerIds.get(tenantA).add(customerA.id);

      const duplicateA = await request("/api/customers", staffASession.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Alex A duplicate",
          email: `shared-${suffix}@example.invalid`,
          phone: "",
        }),
      });
      assert.equal(duplicateA.status, 201);
      const duplicateAData = await duplicateA.json();
      customerIds.get(tenantA).add(duplicateAData.customer.id);
      assert.deepEqual(duplicateAData.warnings[0].matchingFields, ["email"]);

      const createB = await request("/api/customers", staffBSession.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Customer B",
          email: `tenant-b-${suffix}@example.invalid`,
          phone: "",
        }),
      });
      assert.equal(createB.status, 201);
      const customerB = (await createB.json()).customer;
      customerIds.get(tenantB).add(customerB.id);

      const listA = await request("/api/customers", staffASession.token);
      assert.equal(listA.status, 200);
      assert.deepEqual(
        (await listA.json()).customers.map((customer) => customer.id).sort(),
        [customerA.id, duplicateAData.customer.id].sort(),
      );

      assert.equal(
        (
          await request(
            `/api/customers/${customerB.id}`,
            staffASession.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/customers/${customerB.id}`,
            staffASession.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/customers/${customerB.id}`,
            staffASession.token,
            {
              method: "PATCH",
              body: JSON.stringify({
                name: "Cross-tenant update",
                email: "",
                phone: "",
              }),
            },
          )
        ).status,
        404,
      );

      const updateA = await request(
        `/api/customers/${customerA.id}`,
        staffASession.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: "Alex Updated",
            email: `alex-${suffix}@example.invalid`,
            phone: "(020) 1234 5678",
          }),
        },
      );
      assert.equal(updateA.status, 200);
      assert.equal((await updateA.json()).customer.phone, "02012345678");

      const staffErase = await request(
        `/api/customers/${customerA.id}/erase`,
        staffASession.token,
        {
          method: "POST",
          body: JSON.stringify({ confirmation: "ERASE" }),
        },
      );
      assert.equal(staffErase.status, 403);

      const archiveA = await request(
        `/api/customers/${customerA.id}`,
        staffASession.token,
        { method: "DELETE" },
      );
      assert.equal(archiveA.status, 200);
      assert.equal((await archiveA.json()).customer.status, "archived");

      const eraseA = await request(
        `/api/customers/${customerA.id}/erase`,
        adminASession.token,
        {
          method: "POST",
          body: JSON.stringify({ confirmation: "ERASE" }),
        },
      );
      assert.equal(eraseA.status, 200);
      const erased = (
        await customerContainer().item(customerA.id, tenantA).read()
      ).resource;
      assert.equal(erased.status, "erased");
      assert.equal("name" in erased, false);
      assert.equal("searchName" in erased, false);
      assert.equal("email" in erased, false);
      assert.equal("phone" in erased, false);
    } finally {
      for (const [tenantId, ids] of customerIds) {
        for (const id of ids) {
          await customerContainer().item(id, tenantId).delete().catch(() => {});
        }
      }
      for (const session of sessions) {
        await deleteDocument(
          sessionContainer(),
          session.document.id,
          session.document.partitionKey,
        ).catch(() => {});
      }
      for (const user of users) {
        await deleteDocument(
          controlContainer(),
          user.id,
          user.partitionKey,
        ).catch(() => {});
      }
      for (const tenantId of [tenantA, tenantB]) {
        await deleteDocument(
          controlContainer(),
          tenantId,
          tenantId,
        ).catch(() => {});
      }
    }
  },
);
