import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  addConversationMessageForContext,
  processIncomingProviderMessage,
} from "../src/server/conversation-service.ts";
import {
  channelIdentityContainer,
  conversationContainer,
} from "../src/server/conversation-storage.ts";

const baseUrl = process.env.CONVERSATION_TEST_BASE_URL;

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function identityId(address) {
  return `identity_${createHash("sha256")
    .update(`FACEBOOK\n${address}`)
    .digest("hex")}`;
}

test(
  "Meta Messenger processing preserves tenant isolation and idempotency",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const sender = "987654321098765";
    const pageA = "123456789012345";
    const pageB = "234567890123456";
    const previousProvider = process.env.MESSAGING_PROVIDER;
    const previousRoutes = process.env.META_MESSENGER_ROUTES;
    const previousFetch = globalThis.fetch;
    const now = new Date().toISOString();
    const conversations = [
      { tenantId: tenantA, conversationId: conversationA },
      { tenantId: tenantB, conversationId: conversationB },
    ];
    process.env.MESSAGING_PROVIDER = "POSTMARK";
    process.env.META_MESSENGER_ROUTES = JSON.stringify([
      {
        tenantId: tenantA,
        pageId: pageA,
        pageAccessToken: "tenant-a-page-access-token",
        appSecret: "shared-meta-app-secret",
        verifyToken: "shared-meta-verify-token",
        graphApiVersion: "v27.0",
      },
      {
        tenantId: tenantB,
        pageId: pageB,
        pageAccessToken: "tenant-b-page-access-token",
        appSecret: "shared-meta-app-secret",
        verifyToken: "shared-meta-verify-token",
        graphApiVersion: "v27.0",
      },
    ]);
    let sendCount = 0;
    globalThis.fetch = async (input, init) => {
      sendCount += 1;
      assert.equal(
        input,
        `https://graph.facebook.com/v27.0/${pageA}/messages`,
      );
      assert.equal(
        init.headers.Authorization,
        "Bearer tenant-a-page-access-token",
      );
      assert.deepEqual(JSON.parse(init.body), {
        recipient: { id: sender },
        messaging_type: "RESPONSE",
        message: { text: "Your booking is confirmed." },
      });
      return Response.json({
        recipient_id: sender,
        message_id: "m_meta_outbound_integration",
      });
    };

    try {
      for (const item of conversations) {
        const id = identityId(sender);
        await channelIdentityContainer().items.create({
          id,
          tenantId: item.tenantId,
          type: "channel-identity",
          schemaVersion: 1,
          channel: "FACEBOOK",
          normalizedAddress: sender,
          displayLabel: "Facebook contact",
          conversationId: item.conversationId,
          createdAt: now,
          updatedAt: now,
        });
        await conversationContainer().items.create({
          id: item.conversationId,
          tenantId: item.tenantId,
          conversationId: item.conversationId,
          type: "conversation",
          schemaVersion: 1,
          channelIdentityId: id,
          contactLabel: "Facebook contact",
          channel: "FACEBOOK",
          messageCount: 0,
          lastMessagePreview: "",
          lastMessageDirection: "INBOUND",
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      const requestId = randomUUID();
      const tenantContext = {
        tenantId: tenantA,
        businessName: "Facebook test company",
        username: "company-user",
        role: "company_user",
      };
      const sent = await addConversationMessageForContext(
        tenantContext,
        conversationA,
        {
          body: "Your booking is confirmed.",
          direction: "OUTBOUND",
          requestId,
        },
      );
      assert.equal(sent.message.deliveryStatus, "SENT");
      const sentDocument = (
        await conversationContainer()
          .item(requestId, [tenantA, conversationA])
          .read()
      ).resource;
      assert.equal(sentDocument.messagingProvider, "META");
      assert.equal(
        sentDocument.externalMessageId,
        "m_meta_outbound_integration",
      );
      const repeated = await addConversationMessageForContext(
        tenantContext,
        conversationA,
        {
          body: "Your booking is confirmed.",
          direction: "OUTBOUND",
          requestId,
        },
      );
      assert.equal(repeated.message.id, sent.message.id);
      assert.equal(sendCount, 1);

      const incoming = {
        provider: "META",
        tenantId: tenantA,
        providerEventId: "m_meta_inbound_a",
        externalMessageId: "m_meta_inbound_a",
        channel: "FACEBOOK",
        senderAddress: sender,
        recipientAddress: pageA,
        providerRouteKey: pageA,
        body: "Can I move my booking?",
        receivedAt: new Date().toISOString(),
      };
      assert.equal(
        (await processIncomingProviderMessage(incoming)).status,
        "PROCESSED",
      );
      assert.equal(
        (await processIncomingProviderMessage(incoming)).status,
        "DUPLICATE",
      );
      assert.equal(
        (
          await processIncomingProviderMessage({
            ...incoming,
            tenantId: tenantB,
            providerEventId: "m_meta_inbound_b",
            externalMessageId: "m_meta_inbound_b",
            recipientAddress: pageB,
            providerRouteKey: pageB,
          })
        ).status,
        "PROCESSED",
      );

      const storedA = (
        await conversationContainer()
          .item(conversationA, [tenantA, conversationA])
          .read()
      ).resource;
      const storedB = (
        await conversationContainer()
          .item(conversationB, [tenantB, conversationB])
          .read()
      ).resource;
      assert.equal(storedA.messageCount, 2);
      assert.equal(storedB.messageCount, 1);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnvironment("MESSAGING_PROVIDER", previousProvider);
      restoreEnvironment("META_MESSENGER_ROUTES", previousRoutes);
      for (const item of conversations) {
        const documents = await conversationContainer().items
          .query("SELECT c.id FROM c", {
            partitionKey: [item.tenantId, item.conversationId],
          })
          .fetchAll();
        for (const document of documents.resources) {
          await conversationContainer()
            .item(document.id, [item.tenantId, item.conversationId])
            .delete()
            .catch(() => {});
        }
        await channelIdentityContainer()
          .item(identityId(sender), item.tenantId)
          .delete()
          .catch(() => {});
      }
    }
  },
);
