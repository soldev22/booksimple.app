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
import { paymentContainer } from "../src/server/payment-storage.ts";
import { processDueReminders } from "../src/server/reminder-service.ts";
import { reminderContainer } from "../src/server/reminder-storage.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function syntheticUser(email, tenantId, role = "company_user") {
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
      username: `${role}-${randomUUID().slice(0, 8)}`,
      role,
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
    const serviceAdminA = syntheticUser(
      `booking-service-admin-a-${suffix}@example.invalid`,
      tenantA,
      "company_admin",
    );
    const serviceAdminB = syntheticUser(
      `booking-service-admin-b-${suffix}@example.invalid`,
      tenantB,
      "company_admin",
    );
    const users = [userA, userB, serviceAdminA, serviceAdminB];
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
    const paymentIds = new Map([
      [tenantA, new Set()],
      [tenantB, new Set()],
    ]);
    const reminderIds = new Map([
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
          defaultDepositPercentage: tenantId === tenantA ? 25 : 0,
          reminderRules:
            tenantId === tenantA
              ? [
                  {
                    id: "email-10080",
                    channel: "EMAIL",
                    offsetMinutes: 10080,
                  },
                  {
                    id: "sms-120",
                    channel: "SMS",
                    offsetMinutes: 120,
                  },
                ]
              : [
                  {
                    id: "whatsapp-60",
                    channel: "WHATSAPP",
                    offsetMinutes: 60,
                  },
                ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [sessionA, sessionB, serviceAdminSessionA, serviceAdminSessionB] =
        sessions;

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
      const serviceA = await createService(serviceAdminSessionA.token, tenantA, {
        name: "General appointment",
        description: "",
        durationMinutes: "60",
        price: "25.50",
        currency: "GBP",
      });
      const replacementServiceA = await createService(
        serviceAdminSessionA.token,
        tenantA,
        {
          name: "Extended appointment",
          description: "",
          durationMinutes: "90",
          price: "40.00",
          currency: "GBP",
        },
      );
      const serviceB = await createService(serviceAdminSessionB.token, tenantB, {
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
      assert.equal(bookingA.defaultDepositPercentage, 25);
      assert.equal(bookingA.appliedDepositPercentage, 25);
      assert.equal(bookingA.depositAmountMinor, 638);
      assert.equal(bookingA.depositOverridden, false);
      assert.equal(bookingA.status, "PENDING");
      assert.equal(bookingA.conversationId, conversation.id);
      const reminderResponseA = await request(
        `/api/reminders?bookingId=${bookingA.id}`,
        sessionA.token,
      );
      assert.equal(reminderResponseA.status, 200);
      const initialRemindersA = (await reminderResponseA.json()).reminders;
      for (const reminder of initialRemindersA) {
        reminderIds.get(tenantA).add(reminder.id);
      }
      assert.deepEqual(
        initialRemindersA.map(
          ({ channel, scheduledFor, status, provider }) => ({
            channel,
            scheduledFor,
            status,
            provider,
          }),
        ),
        [
          {
            channel: "EMAIL",
            scheduledFor: "2026-11-24T10:00:00.000Z",
            status: "PENDING",
            provider: "MOCK_TEST",
          },
          {
            channel: "SMS",
            scheduledFor: "2026-12-01T08:00:00.000Z",
            status: "PENDING",
            provider: "MOCK_TEST",
          },
        ],
      );

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
      assert.equal(bookingB.depositAmountMinor, 0);
      const reminderResponseB = await request(
        `/api/reminders?bookingId=${bookingB.id}`,
        sessionB.token,
      );
      assert.equal(reminderResponseB.status, 200);
      const remindersB = (await reminderResponseB.json()).reminders;
      for (const reminder of remindersB) {
        reminderIds.get(tenantB).add(reminder.id);
      }
      assert.equal(remindersB.length, 1);
      assert.equal(
        (
          await request(
            `/api/reminders?bookingId=${bookingB.id}`,
            sessionA.token,
          )
        ).status,
        404,
      );

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
          await request(
            `/api/bookings/${bookingB.id}/deposit`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ percentage: 50 }),
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
      assert.equal(updatedA.defaultDepositPercentage, 25);
      assert.equal(updatedA.appliedDepositPercentage, 25);
      assert.equal(updatedA.depositAmountMinor, 1000);
      const rescheduledReminders = (
        await (
          await request(
            `/api/reminders?bookingId=${bookingA.id}`,
            sessionA.token,
          )
        ).json()
      ).reminders;
      assert.deepEqual(
        rescheduledReminders.map(
          ({ channel, scheduledFor }) => ({ channel, scheduledFor }),
        ),
        [
          {
            channel: "EMAIL",
            scheduledFor: "2026-11-24T12:30:00.000Z",
          },
          {
            channel: "SMS",
            scheduledFor: "2026-12-01T10:30:00.000Z",
          },
        ],
      );
      const firstReminderRun = await processDueReminders({
        tenantId: tenantA,
        now: "2026-11-30T00:00:00.000Z",
      });
      assert.deepEqual(firstReminderRun, {
        claimed: 1,
        sent: 1,
        cancelled: 0,
        failed: 0,
      });
      assert.deepEqual(
        await processDueReminders({
          tenantId: tenantA,
          now: "2026-11-30T00:00:00.000Z",
        }),
        {
          claimed: 0,
          sent: 0,
          cancelled: 0,
          failed: 0,
        },
      );

      const overrideA = await request(
        `/api/bookings/${bookingA.id}/deposit`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ percentage: 1 }),
        },
      );
      assert.equal(overrideA.status, 200);
      const overriddenA = (await overrideA.json()).booking;
      assert.equal(overriddenA.defaultDepositPercentage, 25);
      assert.equal(overriddenA.appliedDepositPercentage, 1);
      assert.equal(overriddenA.depositAmountMinor, 40);
      assert.equal(overriddenA.depositOverridden, true);
      assert.equal(overriddenA.depositOverriddenByUsername, userA.membership.username);
      assert.ok(Date.parse(overriddenA.depositOverriddenAt));

      const paymentRequest = await request(
        "/api/payments",
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ bookingId: bookingA.id }),
        },
      );
      const paymentResult = await paymentRequest.json();
      assert.equal(paymentRequest.status, 201, JSON.stringify(paymentResult));
      const paymentA = paymentResult.payment;
      paymentIds.get(tenantA).add(paymentA.id);
      assert.equal(paymentA.paymentType, "DEPOSIT");
      assert.equal(paymentA.amountMinor, 40);
      assert.equal(paymentA.currency, "GBP");
      assert.equal(paymentA.status, "PENDING");
      assert.equal(paymentA.provider, "MOCK_TEST");
      assert.equal(paymentA.simulated, true);

      const duplicateRequest = await request(
        "/api/payments",
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ bookingId: bookingA.id }),
        },
      );
      assert.equal(duplicateRequest.status, 201);
      assert.equal(
        (await duplicateRequest.json()).payment.id,
        paymentA.id,
      );

      const awaitingBooking = await request(
        `/api/bookings/${bookingA.id}`,
        sessionA.token,
      );
      assert.equal(awaitingBooking.status, 200);
      assert.equal(
        (await awaitingBooking.json()).booking.status,
        "AWAITING_DEPOSIT",
      );

      assert.equal(
        (
          await request(
            `/api/bookings/${bookingA.id}/deposit`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ percentage: 50 }),
            },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/api/bookings/${bookingA.id}`,
            sessionA.token,
            {
              method: "PATCH",
              body: JSON.stringify({
                customerId: customerA.id,
                serviceId: serviceA.id,
                startLocal: "2026-12-01T13:00",
              }),
            },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request("/api/payments", sessionB.token, {
            method: "POST",
            body: JSON.stringify({ bookingId: bookingB.id }),
          })
        ).status,
        409,
      );
      const zeroDepositBalanceRequest = await request(
        "/api/payments",
        sessionB.token,
        {
          method: "POST",
          body: JSON.stringify({
            bookingId: bookingB.id,
            paymentType: "BALANCE",
          }),
        },
      );
      assert.equal(zeroDepositBalanceRequest.status, 201);
      const zeroDepositBalance =
        (await zeroDepositBalanceRequest.json()).payment;
      paymentIds.get(tenantB).add(zeroDepositBalance.id);
      assert.equal(zeroDepositBalance.paymentType, "BALANCE");
      assert.equal(zeroDepositBalance.amountMinor, 1500);
      assert.equal(zeroDepositBalance.currency, "USD");
      assert.equal(
        (
          await request("/api/payments", sessionA.token, {
            method: "POST",
            body: JSON.stringify({
              bookingId: bookingA.id,
              paymentType: "BALANCE",
            }),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            `/api/payments?bookingId=${bookingA.id}`,
            sessionB.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/payments/${paymentA.id}/simulate`,
            sessionB.token,
            {
              method: "POST",
              body: JSON.stringify({ eventId: randomUUID() }),
            },
          )
        ).status,
        404,
      );

      const eventId = randomUUID();
      const simulatedPayment = await request(
        `/api/payments/${paymentA.id}/simulate`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ eventId }),
        },
      );
      assert.equal(simulatedPayment.status, 200);
      const paidPayment = (await simulatedPayment.json()).payment;
      assert.equal(paidPayment.status, "PAID");
      assert.ok(Date.parse(paidPayment.paidAt));

      const duplicateNotification = await request(
        `/api/payments/${paymentA.id}/simulate`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ eventId }),
        },
      );
      assert.equal(duplicateNotification.status, 200);
      assert.equal(
        (await duplicateNotification.json()).payment.paidAt,
        paidPayment.paidAt,
      );

      const confirmedBooking = await request(
        `/api/bookings/${bookingA.id}`,
        sessionA.token,
      );
      assert.equal(confirmedBooking.status, 200);
      assert.equal(
        (await confirmedBooking.json()).booking.status,
        "CONFIRMED",
      );

      const balanceRequest = await request(
        "/api/payments",
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({
            bookingId: bookingA.id,
            paymentType: "BALANCE",
          }),
        },
      );
      assert.equal(balanceRequest.status, 201);
      const balancePayment = (await balanceRequest.json()).payment;
      paymentIds.get(tenantA).add(balancePayment.id);
      assert.equal(balancePayment.paymentType, "BALANCE");
      assert.equal(balancePayment.amountMinor, 3960);
      const paidBalanceResponse = await request(
        `/api/payments/${balancePayment.id}/simulate`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ eventId: randomUUID() }),
        },
      );
      assert.equal(paidBalanceResponse.status, 200);
      assert.equal(
        (await paidBalanceResponse.json()).payment.status,
        "PAID",
      );
      const bookingAfterBalance = await request(
        `/api/bookings/${bookingA.id}`,
        sessionA.token,
      );
      assert.equal(
        (await bookingAfterBalance.json()).booking.status,
        "CONFIRMED",
      );

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
      const cancelledReminders = (
        await (
          await request(
            `/api/reminders?bookingId=${bookingA.id}`,
            sessionA.token,
          )
        ).json()
      ).reminders;
      assert.deepEqual(
        cancelledReminders.map(({ channel, status }) => ({
          channel,
          status,
        })),
        [
          { channel: "EMAIL", status: "SENT" },
          { channel: "SMS", status: "CANCELLED" },
        ],
      );
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
      assert.equal(
        (
          await request(
            `/api/bookings/${bookingA.id}/deposit`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ percentage: 50 }),
            },
          )
        ).status,
        409,
      );

      const storedA = (
        await bookingContainer().item(bookingA.id, tenantA).read()
      ).resource;
      assert.equal(storedA.tenantId, tenantA);
      assert.equal(storedA.customerId, customerA.id);
      assert.equal(storedA.serviceId, replacementServiceA.id);
      assert.equal(storedA.status, "CANCELLED");
      assert.equal(storedA.schemaVersion, 2);
      assert.equal(storedA.defaultDepositPercentage, 25);
      assert.equal(storedA.appliedDepositPercentage, 1);
      assert.equal(storedA.depositAmountMinor, 40);
      assert.equal(storedA.depositOverridden, true);
      assert.equal(storedA.depositOverriddenByUserId, userA.userId);
      const storedPayment = (
        await paymentContainer().item(paymentA.id, tenantA).read()
      ).resource;
      assert.equal(storedPayment.tenantId, tenantA);
      assert.equal(storedPayment.bookingId, bookingA.id);
      assert.equal(storedPayment.status, "PAID");
      assert.equal(storedPayment.providerEventId, eventId);
    } finally {
      for (const [tenantId, ids] of reminderIds) {
        for (const id of ids) {
          await reminderContainer().item(id, tenantId).delete().catch(() => {});
        }
      }
      for (const [tenantId, ids] of paymentIds) {
        for (const id of ids) {
          await paymentContainer().item(id, tenantId).delete().catch(() => {});
        }
      }
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
