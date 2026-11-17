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
import { bookingContainer } from "../src/server/booking-storage.ts";
import {
  channelIdentityContainer,
  conversationContainer,
} from "../src/server/conversation-storage.ts";
import { customerContainer } from "../src/server/customer-storage.ts";
import { serviceContainer } from "../src/server/service-storage.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function syntheticUser(email, tenantId) {
  const now = new Date().toISOString();
  return {
    id: "user",
    userId: randomUUID(),
    partitionKey: accountPartition(email),
    type: "user",
    schemaVersion: 1,
    email,
    name: "Synthetic Booking Manager",
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
      username: `company-user-${randomUUID().slice(0, 8)}`,
      role: "company_user",
    },
  };
}

test(
  "Booking APIs enforce tenant ownership, time and lifecycle rules",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const suffix = randomUUID();
    const userA = syntheticUser(
      `booking-user-a-${suffix}@example.invalid`,
      tenantA,
    );
    const userB = syntheticUser(
      `booking-user-b-${suffix}@example.invalid`,
      tenantB,
    );
    const users = [userA, userB];
    const sessions = [];
    const customerIds = new Map([
      [tenantA, new Set()],
      [tenantB, new Set()],
    ]);
    const serviceIds = new Map([
      [tenantA, new Set()],
      [tenantB, new Set()],
    ]);
    const bookingIds = new Map([
      [tenantA, new Set()],
      [tenantB, new Set()],
    ]);
    const conversationIds = new Map([
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

    async function createCustomer(token, tenantId, input) {
      const response = await request("/api/customers", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 201);
      const customer = (await response.json()).customer;
      customerIds.get(tenantId).add(customer.id);
      return customer;
    }

    async function createService(token, tenantId, input) {
      const response = await request("/api/services", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 201);
      const service = (await response.json()).service;
      serviceIds.get(tenantId).add(service.id);
      return service;
    }

    async function createBooking(token, tenantId, input, status = 201) {
      const response = await request("/api/bookings", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      if (result.booking) bookingIds.get(tenantId).add(result.booking.id);
      return result;
    }

    try {
      for (const [tenantId, name, timeZone, currency] of [
        [tenantA, "Booking test company A", "Europe/London", "GBP"],
        [tenantB, "Booking test company B", "America/New_York", "USD"],
      ]) {
        await createDocument(controlContainer(), {
          id: tenantId,
          partitionKey: tenantId,
          type: "business",
          schemaVersion: 1,
          name,
          status: "active",
          memberCount: 1,
          timezone: timeZone,
          currency,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [sessionA, sessionB] = sessions;

      const unauthenticated = await request("/bookings");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      assert.equal((await request("/bookings", sessionA.token)).status, 200);

      const customerA = await createCustomer(sessionA.token, tenantA, {
        name: "Booking Customer A",
        email: `booking-a-${suffix}@example.invalid`,
        phone: "",
      });
      const otherCustomerA = await createCustomer(sessionA.token, tenantA, {
        name: "Other Customer A",
        email: `booking-other-${suffix}@example.invalid`,
        phone: "",
      });
      const customerB = await createCustomer(sessionB.token, tenantB, {
        name: "Booking Customer B",
        email: `booking-b-${suffix}@example.invalid`,
        phone: "",
      });
      const serviceA = await createService(sessionA.token, tenantA, {
        name: "General appointment",
        description: "",
        durationMinutes: "60",
        price: "25.50",
        currency: "GBP",
      });
      const replacementServiceA = await createService(
        sessionA.token,
        tenantA,
        {
          name: "Extended appointment",
          description: "",
          durationMinutes: "90",
          price: "40.00",
          currency: "GBP",
        },
      );
      const serviceB = await createService(sessionB.token, tenantB, {
        name: "Tenant B appointment",
        description: "",
        durationMinutes: "30",
        price: "15.00",
        currency: "USD",
      });

      const injected = await request("/api/bookings", sessionA.token, {
        method: "POST",
        body: JSON.stringify({
          customerId: customerA.id,
          serviceId: serviceA.id,
          startLocal: "2026-12-01T10:00",
          tenantId: tenantB,
        }),
      });
      assert.equal(injected.status, 400);

      const conversationResponse = await request(
        "/api/conversations",
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({
            channel: "EMAIL",
            contactValue: customerA.email,
            contactLabel: customerA.name,
            initialMessage: "Please book an appointment.",
            direction: "INBOUND",
          }),
        },
      );
      assert.equal(conversationResponse.status, 201);
      const conversation = (await conversationResponse.json()).conversation;
      conversationIds.get(tenantA).add(conversation.id);
      assert.equal(conversation.customerId, customerA.id);

      const createdA = await createBooking(sessionA.token, tenantA, {
        customerId: customerA.id,
        serviceId: serviceA.id,
        conversationId: conversation.id,
        startLocal: "2026-12-01T10:00",
      });
      const bookingA = createdA.booking;
      assert.equal(bookingA.startAt, "2026-12-01T10:00:00.000Z");
      assert.equal(bookingA.endAt, "2026-12-01T11:00:00.000Z");
      assert.equal(bookingA.timeZone, "Europe/London");
      assert.equal(bookingA.durationMinutes, 60);
      assert.equal(bookingA.totalAmountMinor, 2550);
      assert.equal(bookingA.currency, "GBP");
      assert.equal(bookingA.status, "PENDING");
      assert.equal(bookingA.conversationId, conversation.id);

      const mismatch = await request("/api/bookings", sessionA.token, {
        method: "POST",
        body: JSON.stringify({
          customerId: otherCustomerA.id,
          serviceId: serviceA.id,
          conversationId: conversation.id,
          startLocal: "2026-12-01T12:00",
        }),
      });
      assert.equal(mismatch.status, 409);

      const createdB = await createBooking(sessionB.token, tenantB, {
        customerId: customerB.id,
        serviceId: serviceB.id,
        startLocal: "2026-12-01T10:00",
      });
      const bookingB = createdB.booking;
      assert.equal(bookingB.startAt, "2026-12-01T15:00:00.000Z");

      const listA = await request("/api/bookings", sessionA.token);
      assert.equal(listA.status, 200);
      const listAData = await listA.json();
      assert.equal(listAData.timeZone, "Europe/London");
      assert.deepEqual(
        listAData.bookings.map((booking) => booking.id),
        [bookingA.id],
      );
      const customerListA = await request(
        `/api/bookings?customerId=${customerA.id}`,
        sessionA.token,
      );
      assert.equal(customerListA.status, 200);
      assert.deepEqual(
        (await customerListA.json()).bookings.map((booking) => booking.id),
        [bookingA.id],
      );

      assert.equal(
        (
          await request(`/api/bookings/${bookingB.id}`, sessionA.token)
        ).status,
        404,
      );
      assert.equal(
        (await request(`/bookings/${bookingB.id}`, sessionA.token)).status,
        404,
      );
      assert.equal(
        (
          await request(`/api/bookings/${bookingB.id}`, sessionA.token, {
            method: "PATCH",
            body: JSON.stringify({
              customerId: customerA.id,
              serviceId: serviceA.id,
              startLocal: "2026-12-01T13:00",
            }),
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/bookings/${bookingB.id}/status`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ status: "CANCELLED" }),
            },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/api/bookings", sessionA.token, {
            method: "POST",
            body: JSON.stringify({
              customerId: customerB.id,
              serviceId: serviceA.id,
              startLocal: "2026-12-01T14:00",
            }),
          })
        ).status,
        404,
      );

      const updateA = await request(
        `/api/bookings/${bookingA.id}`,
        sessionA.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            customerId: customerA.id,
            serviceId: replacementServiceA.id,
            startLocal: "2026-12-01T12:30",
          }),
        },
      );
      assert.equal(updateA.status, 200);
      const updatedA = (await updateA.json()).booking;
      assert.equal(updatedA.startAt, "2026-12-01T12:30:00.000Z");
      assert.equal(updatedA.endAt, "2026-12-01T14:00:00.000Z");
      assert.equal(updatedA.durationMinutes, 90);
      assert.equal(updatedA.totalAmountMinor, 4000);

      const cancelA = await request(
        `/api/bookings/${bookingA.id}/status`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ status: "CANCELLED" }),
        },
      );
      assert.equal(cancelA.status, 200);
      assert.equal((await cancelA.json()).booking.status, "CANCELLED");
      const editCancelled = await request(
        `/api/bookings/${bookingA.id}`,
        sessionA.token,
        {
          method: "PATCH",
          body: JSON.stringify({
            customerId: customerA.id,
            serviceId: replacementServiceA.id,
            startLocal: "2026-12-01T15:00",
          }),
        },
      );
      assert.equal(editCancelled.status, 409);
      const reopenCancelled = await request(
        `/api/bookings/${bookingA.id}/status`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ status: "PENDING" }),
        },
      );
      assert.equal(reopenCancelled.status, 409);

      const storedA = (
        await bookingContainer().item(bookingA.id, tenantA).read()
      ).resource;
      assert.equal(storedA.tenantId, tenantA);
      assert.equal(storedA.customerId, customerA.id);
      assert.equal(storedA.serviceId, replacementServiceA.id);
      assert.equal(storedA.status, "CANCELLED");
    } finally {
      for (const [tenantId, ids] of bookingIds) {
        for (const id of ids) {
          await bookingContainer().item(id, tenantId).delete().catch(() => {});
        }
      }
      for (const [tenantId, ids] of conversationIds) {
        for (const conversationId of ids) {
          const query = conversationContainer().items.query(
            {
              query:
                "SELECT c.id FROM c WHERE c.conversationId = @conversationId",
              parameters: [
                { name: "@conversationId", value: conversationId },
              ],
            },
            { partitionKey: [tenantId, conversationId] },
          );
          for await (const document of query.getAsyncIterator()) {
            await conversationContainer()
              .item(document.id, [tenantId, conversationId])
              .delete()
              .catch(() => {});
          }
        }
      }
      for (const tenantId of [tenantA, tenantB]) {
        const query = channelIdentityContainer().items.query(
          "SELECT c.id FROM c",
          { partitionKey: tenantId },
        );
        for await (const identity of query.getAsyncIterator()) {
          await channelIdentityContainer()
            .item(identity.id, tenantId)
            .delete()
            .catch(() => {});
        }
      }
      for (const [tenantId, ids] of customerIds) {
        for (const id of ids) {
          await customerContainer().item(id, tenantId).delete().catch(() => {});
        }
      }
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
