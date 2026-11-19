import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  channelIdentityContainer,
  conversationContainer,
} from "../src/server/conversation-storage.ts";

const baseUrl = process.env.POSTMARK_WEBHOOK_TEST_BASE_URL;
const username = process.env.POSTMARK_INBOUND_WEBHOOK_USERNAME;
const password = process.env.POSTMARK_INBOUND_WEBHOOK_PASSWORD;

test(
  "Postmark inbound webhook authenticates, routes and deduplicates Email",
  { skip: !baseUrl || !username || !password },
  async () => {
    const tenantId = randomUUID();
    const conversationId = randomUUID();
    const identityId = `identity_${randomBytes(32).toString("hex")}`;
    const routeKey = randomBytes(32).toString("base64url");
    const customerEmail = `postmark-${randomUUID()}@example.invalid`;
    const now = new Date().toISOString();
    const authorization = `Basic ${Buffer.from(
      `${username}:${password}`,
    ).toString("base64")}`;
    const identity = {
      id: identityId,
      tenantId,
      type: "channel-identity",
      schemaVersion: 1,
      channel: "EMAIL",
      normalizedAddress: customerEmail,
      displayLabel: "Postmark webhook contact",
      conversationId,
      inboundRouteKey: routeKey,
      createdAt: now,
      updatedAt: now,
    };
    const conversation = {
      id: conversationId,
      tenantId,
      conversationId,
      type: "conversation",
      schemaVersion: 1,
      channelIdentityId: identityId,
      contactLabel: "Postmark webhook contact",
      channel: "EMAIL",
      messageCount: 0,
      lastMessagePreview: "",
      lastMessageDirection: "INBOUND",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const payload = {
      MessageID: randomUUID(),
      FromFull: { Email: customerEmail },
      ToFull: [{ Email: "inbound@example.invalid" }],
      MailboxHash: routeKey,
      Date: now,
      TextBody: "Webhook test message",
      StrippedTextReply: "Webhook test message",
      Attachments: [],
    };
    const post = (body, auth = authorization) =>
      fetch(new URL("/api/webhooks/postmark/inbound", baseUrl), {
        method: "POST",
        headers: {
          authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    try {
      await channelIdentityContainer().items.create(identity);
      await conversationContainer().items.create(conversation);

      const unauthorized = await post(
        payload,
        `Basic ${Buffer.from(`${username}:wrong`).toString("base64")}`,
      );
      assert.equal(unauthorized.status, 401);

      const first = await post(payload);
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), {
        accepted: true,
        processed: 1,
        duplicates: 0,
        ignored: 0,
      });
      const duplicate = await post(payload);
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await duplicate.json(), {
        accepted: true,
        processed: 0,
        duplicates: 1,
        ignored: 0,
      });
      const wrongSender = await post({
        ...payload,
        MessageID: randomUUID(),
        FromFull: { Email: "other-tenant@example.invalid" },
      });
      assert.equal(wrongSender.status, 200);
      assert.equal((await wrongSender.json()).ignored, 1);

      const storedConversation = (
        await conversationContainer()
          .item(conversationId, [tenantId, conversationId])
          .read()
      ).resource;
      assert.equal(storedConversation.messageCount, 1);
      const messages = await conversationContainer().items
        .query("SELECT * FROM c WHERE c.type = 'message'", {
          partitionKey: [tenantId, conversationId],
        })
        .fetchAll();
      assert.equal(messages.resources.length, 1);
      assert.equal(messages.resources[0].externalMessageId, payload.MessageID);
      assert.equal(messages.resources[0].messagingProvider, "POSTMARK");
    } finally {
      const documents = await conversationContainer().items
        .query("SELECT c.id FROM c", {
          partitionKey: [tenantId, conversationId],
        })
        .fetchAll();
      for (const document of documents.resources) {
        await conversationContainer()
          .item(document.id, [tenantId, conversationId])
          .delete()
          .catch(() => {});
      }
      await channelIdentityContainer()
        .item(identityId, tenantId)
        .delete()
        .catch(() => {});
    }
  },
);
