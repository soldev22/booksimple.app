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
    .update(`WHATSAPP\n${address}`)
    .digest("hex")}`;
}

test(
  "Twilio WhatsApp processing preserves tenant isolation and idempotency",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const sender = "+447700900123";
    const destinationA = "+14155238886";
    const destinationB = "+14155238887";
    const accountA = `AC${"7".repeat(32)}`;
    const accountB = `AC${"8".repeat(32)}`;
    const previousProvider = process.env.MESSAGING_PROVIDER;
    const previousRoutes = process.env.TWILIO_SMS_ROUTES;
    const previousSenders = process.env.TWILIO_WHATSAPP_SENDERS;
    const previousFetch = globalThis.fetch;
    const now = new Date().toISOString();
    const conversations = [
      { tenantId: tenantA, conversationId: conversationA },
      { tenantId: tenantB, conversationId: conversationB },
    ];
    process.env.MESSAGING_PROVIDER = "POSTMARK";
    process.env.TWILIO_SMS_ROUTES = JSON.stringify([
      {
        tenantId: tenantA,
        accountSid: accountA,
        authToken: "tenant-a-token",
        fromNumber: "+447700900991",
      },
      {
        tenantId: tenantB,
        accountSid: accountB,
        authToken: "tenant-b-token",
        fromNumber: "+447700900992",
      },
    ]);
    process.env.TWILIO_WHATSAPP_SENDERS = JSON.stringify([
      { tenantId: tenantA, fromNumber: destinationA },
      { tenantId: tenantB, fromNumber: destinationB },
    ]);
    let sendCount = 0;
    globalThis.fetch = async (input, init) => {
      sendCount += 1;
      assert.equal(
        input,
        `https://api.twilio.com/2010-04-01/Accounts/${accountA}/Messages.json`,
      );
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("From"), `whatsapp:${destinationA}`);
      assert.equal(body.get("To"), `whatsapp:${sender}`);
      return Response.json({
        sid: `SM${"9".repeat(32)}`,
        status: "queued",
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
          channel: "WHATSAPP",
          normalizedAddress: sender,
          displayLabel: "WhatsApp contact",
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
          contactLabel: "WhatsApp contact",
          channel: "WHATSAPP",
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
        businessName: "WhatsApp test company",
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
      assert.equal(sentDocument.messagingProvider, "TWILIO");
      assert.equal(sentDocument.externalMessageId, `SM${"9".repeat(32)}`);
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
        provider: "TWILIO",
        tenantId: tenantA,
        providerEventId: `SM${"a".repeat(32)}`,
        externalMessageId: `SM${"a".repeat(32)}`,
        channel: "WHATSAPP",
        senderAddress: sender,
        recipientAddress: destinationA,
        providerRouteKey: destinationA,
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
            providerEventId: `SM${"b".repeat(32)}`,
            externalMessageId: `SM${"b".repeat(32)}`,
            recipientAddress: destinationB,
            providerRouteKey: destinationB,
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
      restoreEnvironment("TWILIO_SMS_ROUTES", previousRoutes);
      restoreEnvironment("TWILIO_WHATSAPP_SENDERS", previousSenders);
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
