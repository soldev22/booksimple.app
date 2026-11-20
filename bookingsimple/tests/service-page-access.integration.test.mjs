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
import { serviceContainer } from "../src/server/service-storage.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function syntheticUser(email, tenantId, role = "company_admin") {
  const now = new Date().toISOString();
  return {
    id: "user",
    userId: randomUUID(),
    partitionKey: accountPartition(email),
    type: "user",
    schemaVersion: 1,
    email,
    name: "Synthetic Service Manager",
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
  "Service APIs enforce tenant isolation and minor-unit pricing",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const suffix = randomUUID();
    const userA = syntheticUser(
      `service-user-a-${suffix}@example.invalid`,
      tenantA,
    );
    const userB = syntheticUser(
      `service-user-b-${suffix}@example.invalid`,
      tenantB,
    );
    const staffA = syntheticUser(
      `service-staff-a-${suffix}@example.invalid`,
      tenantA,
      "company_user",
    );
    const users = [userA, userB, staffA];
    const sessions = [];
    const serviceIds = new Map([
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
      for (const [tenantId, name, currency] of [
        [tenantA, "Service test company A", "GBP"],
        [tenantB, "Service test company B", "USD"],
      ]) {
        await createDocument(controlContainer(), {
          id: tenantId,
          partitionKey: tenantId,
          type: "business",
          schemaVersion: 1,
          name,
          status: "active",
          memberCount: 1,
          timezone: "Europe/London",
          currency,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [sessionA, sessionB, staffSessionA] = sessions;

      const unauthenticated = await request("/services");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      const adminServicesPage = await request("/services", sessionA.token);
      assert.equal(adminServicesPage.status, 200);
      const adminServicesHtml = await adminServicesPage.text();
      assert.match(adminServicesHtml, /<h2>Add Service/);
      assert.match(adminServicesHtml, /href="\/services"/);
      const staffServicesPage = await request(
        "/services",
        staffSessionA.token,
      );
      assert.equal(staffServicesPage.status, 200);
      const staffServicesHtml = await staffServicesPage.text();
      assert.doesNotMatch(staffServicesHtml, /<h2>Add Service/);
      assert.doesNotMatch(staffServicesHtml, /href="\/services"/);

      const staffCreate = await request(
        "/api/services",
        staffSessionA.token,
        {
          method: "POST",
          body: JSON.stringify({
            name: "Staff-created Service",
            description: "",
            durationMinutes: "30",
            price: "10",
            currency: "GBP",
          }),
        },
      );
      assert.equal(staffCreate.status, 403);

      const injectedTenant = await request("/api/services", sessionA.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Injected",
          description: "",
          durationMinutes: "30",
          price: "10",
          currency: "GBP",
          tenantId: tenantB,
        }),
      });
      assert.equal(injectedTenant.status, 400);

      const createA = await request("/api/services", sessionA.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Initial consultation",
          description: "A general introductory appointment.",
          durationMinutes: "60",
          price: "25.50",
          currency: "GBP",
        }),
      });
      assert.equal(createA.status, 201);
      const serviceA = (await createA.json()).service;
      serviceIds.get(tenantA).add(serviceA.id);
      assert.equal(serviceA.priceMinor, 2550);
      assert.equal(serviceA.active, true);

      const createB = await request("/api/services", sessionB.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Tenant B Service",
          description: "",
          durationMinutes: "45",
          price: "10.00",
          currency: "USD",
        }),
      });
      assert.equal(createB.status, 201);
      const serviceB = (await createB.json()).service;
      serviceIds.get(tenantB).add(serviceB.id);

      const listA = await request("/api/services", sessionA.token);
      assert.equal(listA.status, 200);
      const listAData = await listA.json();
      assert.deepEqual(
        listAData.services.map((service) => service.id),
        [serviceA.id],
      );
      assert.equal(listAData.defaultCurrency, "GBP");

      const searchA = await request(
        "/api/services?search=introductory",
        sessionA.token,
      );
      assert.equal(searchA.status, 200);
      assert.deepEqual(
        (await searchA.json()).services.map((service) => service.id),
        [serviceA.id],
      );

      assert.equal(
        (
          await request(`/api/services/${serviceB.id}`, sessionA.token)
        ).status,
        404,
      );
      assert.equal(
        (await request(`/services/${serviceB.id}`, sessionA.token)).status,
        404,
      );
      assert.equal(
        (
          await request(`/api/services/${serviceB.id}`, sessionA.token, {
            method: "PATCH",
            body: JSON.stringify({
              name: "Cross-tenant update",
              description: "",
              durationMinutes: "30",
              price: "0",
              currency: "GBP",
            }),
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/services/${serviceB.id}/status`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ active: false }),
            },
          )
        ).status,
        404,
      );

      const updateA = await request(
        `/api/services/${serviceA.id}`,
        sessionA.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: "Updated consultation",
            description: "Updated description.",
            durationMinutes: "90",
            price: "0",
            currency: "GBP",
          }),
        },
      );
      assert.equal(updateA.status, 200);
      const updatedA = (await updateA.json()).service;
      assert.equal(updatedA.durationMinutes, 90);
      assert.equal(updatedA.priceMinor, 0);

      const deactivateA = await request(
        `/api/services/${serviceA.id}/status`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ active: false }),
        },
      );
      assert.equal(deactivateA.status, 200);
      assert.equal((await deactivateA.json()).service.active, false);

      const inactiveA = await request(
        "/api/services?status=inactive",
        sessionA.token,
      );
      assert.equal(inactiveA.status, 200);
      assert.deepEqual(
        (await inactiveA.json()).services.map((service) => service.id),
        [serviceA.id],
      );

      const storedA = (
        await serviceContainer().item(serviceA.id, tenantA).read()
      ).resource;
      assert.equal(storedA.tenantId, tenantA);
      assert.equal(storedA.priceMinor, 0);
      assert.equal(storedA.currency, "GBP");
      assert.equal(storedA.active, false);
    } finally {
      for (const [tenantId, ids] of serviceIds) {
        for (const id of ids) {
          await serviceContainer().item(id, tenantId).delete().catch(() => {});
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
