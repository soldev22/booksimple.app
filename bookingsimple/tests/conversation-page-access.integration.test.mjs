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
import { getOperationalDashboard } from "../src/server/dashboard-service.ts";
import {
  addConversationMessageForContext,
  processIncomingProviderMessage,
} from "../src/server/conversation-service.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function syntheticUser(email, tenantId, role = "company_user") {
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
      role,
    },
  };
}

test(
  "Conversation APIs isolate tenants, match Customers and keep mock replies local",
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
    const adminA = syntheticUser(
      `conversation-admin-a-${suffix}@example.invalid`,
      tenantA,
      "company_admin",
    );
    const users = [userA, userB, adminA];
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
    const originalFetch = globalThis.fetch;
    const originalEnvironment = {
      messagingProvider: process.env.MESSAGING_PROVIDER,
      postmarkToken: process.env.POSTMARK_SERVER_TOKEN,
      postmarkFrom: process.env.POSTMARK_FROM_EMAIL,
      inboundAddress: process.env.POSTMARK_INBOUND_ADDRESS,
    };
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
      const [sessionA, sessionB, adminSessionA] = sessions;

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
            requestId: randomUUID(),
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
                requestId: randomUUID(),
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

      process.env.MESSAGING_PROVIDER = "POSTMARK";
      process.env.POSTMARK_SERVER_TOKEN = "stage14-test-token";
      process.env.POSTMARK_FROM_EMAIL = "messages@example.test";
      process.env.POSTMARK_INBOUND_ADDRESS =
        "ca9ceb66cfef778ea61ebe6a86e5f2da@inbound.postmarkapp.com";
      let sendCount = 0;
      let rejectSend = false;
      globalThis.fetch = async (_input, init) => {
        sendCount += 1;
        if (rejectSend) {
          return Response.json(
            { ErrorCode: 406, Message: "Inactive recipient" },
            { status: 422 },
          );
        }
        const body = JSON.parse(init.body);
        return Response.json({
          ErrorCode: 0,
          Message: "OK",
          MessageID: `postmark-${body.Metadata.messageId}`,
          SubmittedAt: new Date().toISOString(),
          To: body.To,
        });
      };
      const tenantContext = {
        tenantId: tenantA,
        businessName: "Conversation test company A",
        username: userA.membership.username,
        role: "company_user",
      };
      const sentRequestId = randomUUID();
      const sent = await addConversationMessageForContext(
        tenantContext,
        exactConversation.conversation.id,
        {
          body: "This is a real Email attempt.",
          direction: "OUTBOUND",
          requestId: sentRequestId,
        },
      );
      assert.equal(sent.message.deliveryStatus, "SENT");
      const repeated = await addConversationMessageForContext(
        tenantContext,
        exactConversation.conversation.id,
        {
          body: "This is a real Email attempt.",
          direction: "OUTBOUND",
          requestId: sentRequestId,
        },
      );
      assert.equal(repeated.message.id, sent.message.id);
      assert.equal(sendCount, 1);
      const sentDocument = (
        await conversationContainer()
          .item(sentRequestId, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      assert.equal(sentDocument.messagingProvider, "POSTMARK");
      assert.equal(
        sentDocument.externalMessageId,
        `postmark-${sentRequestId}`,
      );

      rejectSend = true;
      const failedRequestId = randomUUID();
      await assert.rejects(() =>
        addConversationMessageForContext(
          tenantContext,
          exactConversation.conversation.id,
          {
            body: "This provider attempt will fail.",
            direction: "OUTBOUND",
            requestId: failedRequestId,
          },
        ),
      );
      const failedDocument = (
        await conversationContainer()
          .item(failedRequestId, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      assert.equal(failedDocument.deliveryStatus, "FAILED");
      assert.equal(failedDocument.failureCategory, "PROVIDER");
      globalThis.fetch = originalFetch;
      restoreEnvironment(
        "MESSAGING_PROVIDER",
        originalEnvironment.messagingProvider,
      );
      restoreEnvironment(
        "POSTMARK_SERVER_TOKEN",
        originalEnvironment.postmarkToken,
      );
      restoreEnvironment("POSTMARK_FROM_EMAIL", originalEnvironment.postmarkFrom);
      restoreEnvironment(
        "POSTMARK_INBOUND_ADDRESS",
        originalEnvironment.inboundAddress,
      );

      const identityQuery = channelIdentityContainer().items.query(
        {
          query:
            "SELECT * FROM c WHERE c.conversationId = @conversationId",
          parameters: [
            {
              name: "@conversationId",
              value: exactConversation.conversation.id,
            },
          ],
        },
        { partitionKey: tenantA },
      );
      const identityPage = await identityQuery.fetchNext();
      assert.equal(identityPage.resources.length, 1);
      const identity = identityPage.resources[0];
      const routeKey = identity.inboundRouteKey;
      assert.match(routeKey, /^[A-Za-z0-9_-]{43}$/);

      const incoming = {
        provider: "POSTMARK",
        providerEventId: `postmark-event-${suffix}`,
        externalMessageId: `postmark-message-${suffix}`,
        channel: "EMAIL",
        senderAddress: exactEmail,
        recipientAddress: "inbound@example.invalid",
        providerRouteKey: routeKey,
        body: "This arrived through Postmark.",
        receivedAt: new Date().toISOString(),
      };
      const archivePath =
        `/api/conversations/${exactConversation.conversation.id}/archive`;
      assert.equal(
        (
          await request(archivePath, sessionA.token, {
            method: "POST",
            body: JSON.stringify({ archived: true }),
          })
        ).status,
        403,
      );
      const archivedResponse = await request(
        archivePath,
        adminSessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ archived: true }),
        },
      );
      assert.equal(archivedResponse.status, 200);
      const archivedConversation = (await archivedResponse.json()).conversation;
      assert.equal(archivedConversation.messageCount, 5);
      assert.equal(
        archivedConversation.archivedByUsername,
        adminA.membership.username,
      );
      const activeAfterArchive = await request(
        "/api/conversations",
        adminSessionA.token,
      );
      assert.equal(activeAfterArchive.status, 200);
      assert.equal(
        (await activeAfterArchive.json()).conversations.some(
          (conversation) =>
            conversation.id === exactConversation.conversation.id,
        ),
        false,
      );
      for (const conversationId of conversationIds.get(tenantA)) {
        if (conversationId === exactConversation.conversation.id) continue;
        assert.equal(
          (
            await request(
              `/api/conversations/${conversationId}/archive`,
              adminSessionA.token,
              {
                method: "POST",
                body: JSON.stringify({ archived: true }),
              },
            )
          ).status,
          200,
        );
      }
      const dashboardAfterArchive = await getOperationalDashboard({
        tenantId: tenantA,
        businessName: "Conversation test company A",
        username: adminA.membership.username,
        role: "company_admin",
      });
      assert.equal(
        dashboardAfterArchive.attentionConversations.length,
        0,
      );
      assert.equal(dashboardAfterArchive.attentionCount, 0);
      const archivedList = await request(
        "/api/conversations?archive=archived",
        adminSessionA.token,
      );
      assert.equal(archivedList.status, 200);
      assert.equal(
        (await archivedList.json()).conversations.some(
          (conversation) =>
            conversation.id === exactConversation.conversation.id,
        ),
        true,
      );
      assert.equal(
        (
          await request(
            "/api/conversations?archive=archived",
            sessionA.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            `/api/conversations/${exactConversation.conversation.id}`,
            sessionA.token,
          )
        ).status,
        404,
      );
      const archivedDetails = await request(
        `/api/conversations/${exactConversation.conversation.id}`,
        adminSessionA.token,
      );
      assert.equal(archivedDetails.status, 200);
      assert.equal((await archivedDetails.json()).messages.length, 5);

      const processed = await processIncomingProviderMessage(incoming);
      assert.equal(processed.status, "PROCESSED");
      const restoredByInbound = await request(
        `/api/conversations/${exactConversation.conversation.id}`,
        sessionA.token,
      );
      assert.equal(restoredByInbound.status, 200);
      assert.equal(
        (await restoredByInbound.json()).conversation.archivedAt,
        undefined,
      );
      const duplicate = await processIncomingProviderMessage(incoming);
      assert.equal(duplicate.status, "DUPLICATE");
      const wrongTenantSender = await processIncomingProviderMessage({
        ...incoming,
        providerEventId: `postmark-event-wrong-${suffix}`,
        externalMessageId: `postmark-message-wrong-${suffix}`,
        senderAddress: tenantBCustomer.email,
      });
      assert.equal(wrongTenantSender.status, "IGNORED");

      const inboundMessage = (
        await conversationContainer()
          .item(processed.messageId, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      assert.equal(inboundMessage.messagingProvider, "POSTMARK");
      assert.equal(
        inboundMessage.externalMessageId,
        incoming.externalMessageId,
      );
      assert.equal(inboundMessage.providerEventId, incoming.providerEventId);
      const afterInbound = (
        await conversationContainer()
          .item(exactConversation.conversation.id, [
            tenantA,
            exactConversation.conversation.id,
          ])
          .read()
      ).resource;
      assert.equal(afterInbound.messageCount, 6);

      assert.equal(
        (
          await request(archivePath, adminSessionA.token, {
            method: "POST",
            body: JSON.stringify({ archived: true }),
          })
        ).status,
        200,
      );
      const restoredResponse = await request(
        archivePath,
        adminSessionA.token,
        {
          method: "POST",
          body: JSON.stringify({ archived: false }),
        },
      );
      assert.equal(restoredResponse.status, 200);
      assert.equal(
        (await restoredResponse.json()).conversation.archivedAt,
        undefined,
      );
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvironment(
        "MESSAGING_PROVIDER",
        originalEnvironment.messagingProvider,
      );
      restoreEnvironment(
        "POSTMARK_SERVER_TOKEN",
        originalEnvironment.postmarkToken,
      );
      restoreEnvironment("POSTMARK_FROM_EMAIL", originalEnvironment.postmarkFrom);
      restoreEnvironment(
        "POSTMARK_INBOUND_ADDRESS",
        originalEnvironment.inboundAddress,
      );
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
