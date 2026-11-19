import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mockMessagingProvider } from "../src/server/mock-messaging-provider.ts";
import {
  parseProviderWebhook,
  sendProviderMessage,
} from "../src/server/messaging-service.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

test("mock provider sends normalized outbound messages idempotently", async () => {
  const input = {
    tenantId,
    conversationId,
    messageId,
    channel: "EMAIL",
    recipientAddress: "customer@example.invalid",
    body: "Your booking is confirmed.",
    requestedAt: "2026-01-01T00:00:00.000Z",
  };
  const first = await sendProviderMessage(mockMessagingProvider, input);
  const duplicate = await sendProviderMessage(mockMessagingProvider, input);
  assert.deepEqual(first, duplicate);
  assert.deepEqual(first, {
    provider: "MOCK_TEST",
    externalMessageId: `mock_msg_${messageId}`,
    status: "ACCEPTED",
    acceptedAt: "2026-01-01T00:00:00.000Z",
  });
});

test("mock provider validates and normalizes inbound webhook payloads", async () => {
  const rawBody = JSON.stringify({
    eventId: "mock_event_123",
    message: {
      id: "mock_external_456",
      channel: "SMS",
      senderAddress: "+447700900123",
      recipientAddress: "+447700900999",
      body: "Can I move my booking?",
      receivedAt: "2026-01-02T03:04:05.000Z",
    },
  });
  const signature = createHash("sha256").update(rawBody).digest("hex");
  assert.deepEqual(
    await parseProviderWebhook(mockMessagingProvider, {
      rawBody,
      headers: { "x-booksimple-mock-signature": signature },
    }),
    [
      {
        provider: "MOCK_TEST",
        providerEventId: "mock_event_123",
        externalMessageId: "mock_external_456",
        channel: "SMS",
        senderAddress: "+447700900123",
        recipientAddress: "+447700900999",
        body: "Can I move my booking?",
        receivedAt: "2026-01-02T03:04:05.000Z",
      },
    ],
  );
});

test("mock provider rejects tampered and provider-specific invalid payloads", async () => {
  const rawBody = JSON.stringify({ eventId: "invalid" });
  await assert.rejects(() =>
    parseProviderWebhook(mockMessagingProvider, {
      rawBody,
      headers: { "x-booksimple-mock-signature": "0".repeat(64) },
    }),
  );
  const signature = createHash("sha256").update(rawBody).digest("hex");
  await assert.rejects(() =>
    parseProviderWebhook(mockMessagingProvider, {
      rawBody,
      headers: { "x-booksimple-mock-signature": signature },
    }),
  );
});

test("messaging service rejects unsupported adapter channels", async () => {
  const emailOnlyProvider = {
    ...mockMessagingProvider,
    supportedChannels: ["EMAIL"],
  };
  await assert.rejects(() =>
    sendProviderMessage(emailOnlyProvider, {
      tenantId,
      conversationId,
      messageId,
      channel: "FACEBOOK",
      recipientAddress: "provider-user-1",
      body: "Hello",
      requestedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
});
