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
import {
  channelIdentityContainer,
  conversationContainer,
} from "../src/server/conversation-storage.ts";
import { customerContainer } from "../src/server/customer-storage.ts";

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
    name: "Synthetic Conversation Manager",
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
  "Conversation APIs isolate tenants, match Customers and keep replies local",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const suffix = randomUUID();
    const userA = syntheticUser(
      `conversation-user-a-${suffix}@example.invalid`,
      tenantA,
    );
    const userB = syntheticUser(
      `conversation-user-b-${suffix}@example.invalid`,
      tenantB,
    );
    const users = [userA, userB];
    const sessions = [];
    const customerIds = new Map([
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

    async function createConversation(token, tenantId, input, status = 201) {
      const response = await request("/api/conversations", token, {
        method: "POST",
        body: JSON.stringify(input),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      conversationIds.get(tenantId).add(result.conversation.id);
      return result;
    }

    try {
      for (const [tenantId, name] of [
        [tenantA, "Conversation test company A"],
        [tenantB, "Conversation test company B"],
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
          currency: "GBP",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [sessionA, sessionB] = sessions;

      const unauthenticated = await request("/inbox");
      assert.equal(unauthenticated.status, 307);
      assert.equal(
        new URL(unauthenticated.headers.get("location"), baseUrl).pathname,
        "/login",
      );
      assert.equal((await request("/inbox", sessionA.token)).status, 200);

      const injectedTenant = await request(
        "/api/conversations",
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({
            channel: "EMAIL",
            contactValue: `injected-${suffix}@example.invalid`,
            contactLabel: "Injected",
            initialMessage: "Hello",
            direction: "INBOUND",
            tenantId: tenantB,
          }),
        },
      );
      assert.equal(injectedTenant.status, 400);

      const exactEmail = `exact-${suffix}@example.invalid`;
      const exactCustomer = await createCustomer(
        sessionA.token,
        tenantA,
        {
          name: "Exact Customer",
          email: exactEmail,
          phone: "",
        },
      );
      const exactConversation = await createConversation(
        sessionA.token,
        tenantA,
        {
          channel: "EMAIL",
          contactValue: exactEmail.toUpperCase(),
          contactLabel: "Exact contact",
          initialMessage: "Can I make a booking?",
          direction: "INBOUND",
        },
      );
      assert.equal(exactConversation.resolution.status, "matched");
      assert.equal(
        exactConversation.conversation.customerId,
        exactCustomer.id,
      );

      const reply = await request(
        `/api/conversations/${exactConversation.conversation.id}/messages`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({
            body: "This is a local reply.",
            direction: "OUTBOUND",
          }),
        },
      );
      assert.equal(reply.status, 201);
      const replyData = await reply.json();
      assert.equal(replyData.message.deliveryStatus, "LOCAL_ONLY");
      assert.equal(replyData.conversation.messageCount, 2);
      assert.equal(
        replyData.conversation.lastMessagePreview,
        "This is a local reply.",
      );

      const storedConversation = (
        await conversationContainer()
          .item(exactConversation.conversation.id, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      const storedMessage = (
        await conversationContainer()
          .item(replyData.message.id, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      assert.equal(storedConversation.messageCount, 2);
      assert.equal(storedConversation.lastMessageAt, storedMessage.createdAt);
      assert.equal(storedMessage.deliveryStatus, "LOCAL_ONLY");

      const ambiguousEmail = `ambiguous-${suffix}@example.invalid`;
      await createCustomer(sessionA.token, tenantA, {
        name: "Ambiguous One",
        email: ambiguousEmail,
        phone: "",
      });
      await createCustomer(sessionA.token, tenantA, {
        name: "Ambiguous Two",
        email: ambiguousEmail,
        phone: "",
      });
      const ambiguousConversation = await createConversation(
        sessionA.token,
        tenantA,
        {
          channel: "EMAIL",
          contactValue: ambiguousEmail,
          contactLabel: "Ambiguous contact",
          initialMessage: "Which record is mine?",
          direction: "INBOUND",
        },
      );
      assert.equal(ambiguousConversation.resolution.status, "ambiguous");
      assert.equal(ambiguousConversation.resolution.candidates.length, 2);
      assert.equal(
        "customerId" in ambiguousConversation.conversation,
        false,
      );

      const noMatchEmail = `no-match-${suffix}@example.invalid`;
      const unmatchedConversation = await createConversation(
        sessionA.token,
        tenantA,
        {
          channel: "EMAIL",
          contactValue: noMatchEmail,
          contactLabel: "New contact",
          initialMessage: "I am new.",
          direction: "INBOUND",
        },
      );
      assert.equal(unmatchedConversation.resolution.status, "unmatched");
      assert.deepEqual(unmatchedConversation.resolution.candidates, []);

      const newCustomer = await createCustomer(sessionA.token, tenantA, {
        name: "New Customer",
        email: noMatchEmail,
        phone: "",
      });
      const linked = await request(
        `/api/conversations/${unmatchedConversation.conversation.id}/customer`,
        sessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ customerId: newCustomer.id }),
        },
      );
      assert.equal(linked.status, 200);
      assert.equal((await linked.json()).conversation.customerId, newCustomer.id);

      const tenantBCustomer = await createCustomer(
        sessionB.token,
        tenantB,
        {
          name: "Tenant B Customer",
          email: `tenant-b-${suffix}@example.invalid`,
          phone: "",
        },
      );
      const tenantBConversation = await createConversation(
        sessionB.token,
        tenantB,
        {
          channel: "EMAIL",
          contactValue: tenantBCustomer.email,
          contactLabel: "Tenant B contact",
          initialMessage: "Private Tenant B message",
          direction: "INBOUND",
        },
      );

      const listA = await request("/api/conversations", sessionA.token);
      assert.equal(listA.status, 200);
      assert.equal(
        (await listA.json()).conversations.some(
          (conversation) =>
            conversation.id === tenantBConversation.conversation.id,
        ),
        false,
      );
      assert.equal(
        (
          await request(
            `/api/conversations/${tenantBConversation.conversation.id}`,
            sessionA.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/inbox/${tenantBConversation.conversation.id}`,
            sessionA.token,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/conversations/${tenantBConversation.conversation.id}/messages`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({
                body: "Cross-tenant write",
                direction: "OUTBOUND",
              }),
            },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/conversations/${exactConversation.conversation.id}/customer`,
            sessionA.token,
            {
              method: "POST",
              body: JSON.stringify({ customerId: tenantBCustomer.id }),
            },
          )
        ).status,
        404,
      );

      const reopened = await createConversation(
        sessionA.token,
        tenantA,
        {
          channel: "EMAIL",
          contactValue: exactEmail,
          contactLabel: "Ignored replacement label",
          initialMessage: "Another message in the same thread.",
          direction: "INBOUND",
        },
        200,
      );
      assert.equal(
        reopened.conversation.id,
        exactConversation.conversation.id,
      );
      assert.equal(reopened.created, false);
      assert.equal(reopened.conversation.messageCount, 3);
    } finally {
      for (const [tenantId, ids] of conversationIds) {
        for (const conversationId of ids) {
          const query = conversationContainer().items.query(
            {
              query:
                "SELECT c.id, c.conversationId FROM c WHERE c.conversationId = @conversationId",
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
