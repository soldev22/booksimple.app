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
    .update(`SMS\n${address}`)
    .digest("hex")}`;
}

test(
  "Twilio SMS send and inbound processing preserve tenant isolation and idempotency",
  { skip: !baseUrl },
  async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const conversationA = randomUUID();
    const conversationB = randomUUID();
    const sender = "+447700900123";
    const destinationA = "+447700900991";
    const destinationB = "+447700900992";
    const accountA = `AC${"1".repeat(32)}`;
    const accountB = `AC${"2".repeat(32)}`;
    const previousProvider = process.env.MESSAGING_PROVIDER;
    const previousRoutes = process.env.TWILIO_SMS_ROUTES;
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
        fromNumber: destinationA,
      },
      {
        tenantId: tenantB,
        accountSid: accountB,
        authToken: "tenant-b-token",
        fromNumber: destinationB,
      },
    ]);
    let sendCount = 0;
    globalThis.fetch = async (input, init) => {
      sendCount += 1;
      assert.equal(
        input,
        `https://api.twilio.com/2010-04-01/Accounts/${accountA}/Messages.json`,
      );
      assert.equal(
        new URLSearchParams(init.body).get("From"),
        destinationA,
      );
      return Response.json({
        sid: `SM${"3".repeat(32)}`,
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
          channel: "SMS",
          normalizedAddress: sender,
          displayLabel: "SMS contact",
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
          contactLabel: "SMS contact",
          channel: "SMS",
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
        businessName: "SMS test company",
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
      assert.equal(sentDocument.externalMessageId, `SM${"3".repeat(32)}`);
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
        providerEventId: `SM${"4".repeat(32)}`,
        externalMessageId: `SM${"4".repeat(32)}`,
        channel: "SMS",
        senderAddress: sender,
        recipientAddress: destinationA,
        providerRouteKey: destinationA,
        body: "Can I move my booking?",
        receivedAt: new Date().toISOString(),
      };
      const processed = await processIncomingProviderMessage(incoming);
      assert.equal(processed.status, "PROCESSED");
      const duplicate = await processIncomingProviderMessage(incoming);
      assert.equal(duplicate.status, "DUPLICATE");

      const otherTenant = await processIncomingProviderMessage({
        ...incoming,
        tenantId: tenantB,
        providerEventId: `SM${"5".repeat(32)}`,
        externalMessageId: `SM${"5".repeat(32)}`,
        recipientAddress: destinationB,
        providerRouteKey: destinationB,
      });
      assert.equal(otherTenant.status, "PROCESSED");
      const unknownTenant = await processIncomingProviderMessage({
        ...incoming,
        tenantId: randomUUID(),
        providerEventId: `SM${"6".repeat(32)}`,
        externalMessageId: `SM${"6".repeat(32)}`,
      });
      assert.equal(unknownTenant.status, "IGNORED");

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
