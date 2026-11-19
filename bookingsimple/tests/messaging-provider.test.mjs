import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { mockMessagingProvider } from "../src/server/mock-messaging-provider.ts";
import {
  parseProviderWebhook,
  sendProviderMessage,
} from "../src/server/messaging-service.ts";
import {
  postmarkInboundReplyAddress,
  postmarkMessagingProvider,
} from "../src/server/postmark-messaging-provider.ts";
import { twilioSmsMessagingProvider } from "../src/server/twilio-sms-messaging-provider.ts";

const tenantId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const twilioAccountSid = `AC${"1".repeat(32)}`;
const twilioAuthToken = "test-twilio-auth-token";
const twilioFromNumber = "+447700900999";

function configureTwilioRoutes(routes) {
  process.env.TWILIO_SMS_ROUTES = JSON.stringify(routes);
  process.env.APP_ORIGIN = "https://booksimple.app";
}

function twilioSignature(url, rawBody) {
  const parameters = Array.from(new URLSearchParams(rawBody).entries()).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const value = parameters.reduce(
    (result, [name, parameter]) => `${result}${name}${parameter}`,
    url,
  );
  return createHmac("sha1", twilioAuthToken)
    .update(value)
    .digest("base64");
}

test("mock provider sends normalized outbound messages idempotently", async () => {
  const input = {
    tenantId,
    conversationId,
    messageId,
    channel: "EMAIL",
    recipientAddress: "customer@example.invalid",
    subject: "Message from Example Business",
    replyAddress: "inbound+route@example.invalid",
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
        providerRouteKey: "+447700900999",
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
      subject: "Message",
      replyAddress: "inbound@example.invalid",
      body: "Hello",
      requestedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
});

test("Postmark provider maps Email sends and validates the provider receipt", async () => {
  const previousFetch = globalThis.fetch;
  process.env.POSTMARK_SERVER_TOKEN = "test-server-token";
  process.env.POSTMARK_FROM_EMAIL = "messages@example.test";
  process.env.POSTMARK_MESSAGE_STREAM = "outbound";
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return Response.json({
      ErrorCode: 0,
      Message: "OK",
      MessageID: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
      SubmittedAt: "2026-01-01T00:00:01.000Z",
      To: "customer@example.test",
    });
  };
  try {
    const receipt = await sendProviderMessage(postmarkMessagingProvider, {
      tenantId,
      conversationId,
      messageId,
      channel: "EMAIL",
      recipientAddress: "customer@example.test",
      subject: "Message from Example Business",
      replyAddress:
        "ca9ceb66cfef778ea61ebe6a86e5f2da+opaque-route@inbound.postmarkapp.com",
      body: "Your booking is confirmed.",
      requestedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(request.input, "https://api.postmarkapp.com/email");
    assert.equal(
      request.init.headers["X-Postmark-Server-Token"],
      "test-server-token",
    );
    assert.deepEqual(JSON.parse(request.init.body), {
      From: "messages@example.test",
      To: "customer@example.test",
      ReplyTo:
        "ca9ceb66cfef778ea61ebe6a86e5f2da+opaque-route@inbound.postmarkapp.com",
      Subject: "Message from Example Business",
      TextBody: "Your booking is confirmed.",
      MessageStream: "outbound",
      Tag: "conversation-message",
      Metadata: { messageId },
    });
    assert.deepEqual(receipt, {
      provider: "POSTMARK",
      externalMessageId: "b7bc2f4a-e38e-4336-af7d-e6c392c2f817",
      status: "ACCEPTED",
      acceptedAt: "2026-01-01T00:00:01.000Z",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Postmark provider rejects provider failures without exposing response content", async () => {
  const previousFetch = globalThis.fetch;
  process.env.POSTMARK_SERVER_TOKEN = "test-server-token";
  process.env.POSTMARK_FROM_EMAIL = "messages@example.test";
  globalThis.fetch = async () =>
    Response.json(
      { ErrorCode: 406, Message: "Inactive recipient" },
      { status: 422 },
    );
  try {
    await assert.rejects(
      () =>
        sendProviderMessage(postmarkMessagingProvider, {
          tenantId,
          conversationId,
          messageId,
          channel: "EMAIL",
          recipientAddress: "customer@example.test",
          subject: "Message from Example Business",
          replyAddress:
            "ca9ceb66cfef778ea61ebe6a86e5f2da+opaque-route@inbound.postmarkapp.com",
          body: "Hello",
          requestedAt: "2026-01-01T00:00:00.000Z",
        }),
      (error) =>
        error?.category === "PROVIDER" &&
        error?.providerStatus === 422 &&
        error?.providerCode === 406 &&
        !error.message.includes("Inactive recipient"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Postmark provider authenticates and normalizes inbound Email", async () => {
  process.env.POSTMARK_INBOUND_WEBHOOK_USERNAME = "webhook-user";
  process.env.POSTMARK_INBOUND_WEBHOOK_PASSWORD = "webhook-password";
  const routeKey = "a".repeat(43);
  const rawBody = JSON.stringify({
    MessageID: "40129f65-40a4-4243-80c6-7f3844c98a7d",
    FromFull: { Email: "Customer@Example.COM" },
    ToFull: [{ Email: "inbound@example.test" }],
    MailboxHash: routeKey,
    Date: "2026-01-02T03:04:05.000Z",
    TextBody: "Quoted history",
    StrippedTextReply: "Can I move my booking?",
    Attachments: [],
  });
  const authorization = `Basic ${Buffer.from(
    "webhook-user:webhook-password",
  ).toString("base64")}`;
  assert.deepEqual(
    await parseProviderWebhook(postmarkMessagingProvider, {
      rawBody,
      headers: { authorization },
    }),
    [
      {
        provider: "POSTMARK",
        providerEventId: "40129f65-40a4-4243-80c6-7f3844c98a7d",
        externalMessageId: "40129f65-40a4-4243-80c6-7f3844c98a7d",
        channel: "EMAIL",
        senderAddress: "customer@example.com",
        recipientAddress: "inbound@example.test",
        providerRouteKey: routeKey,
        body: "Can I move my booking?",
        receivedAt: "2026-01-02T03:04:05.000Z",
      },
    ],
  );
  await assert.rejects(() =>
    parseProviderWebhook(postmarkMessagingProvider, {
      rawBody,
      headers: {
        authorization: `Basic ${Buffer.from(
          "webhook-user:wrong-password",
        ).toString("base64")}`,
      },
    }),
  );
});

test("Postmark reply addresses use an opaque MailboxHash route", () => {
  process.env.POSTMARK_INBOUND_ADDRESS =
    "ca9ceb66cfef778ea61ebe6a86e5f2da@inbound.postmarkapp.com";
  assert.equal(
    postmarkInboundReplyAddress("a".repeat(43)),
    `ca9ceb66cfef778ea61ebe6a86e5f2da+${"a".repeat(43)}@inbound.postmarkapp.com`,
  );
  assert.throws(() => postmarkInboundReplyAddress("tenant-guid"));
});

test("Twilio provider maps tenant-routed SMS sends and validates the receipt", async () => {
  const previousFetch = globalThis.fetch;
  configureTwilioRoutes([
    {
      tenantId,
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    },
  ]);
  let request;
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return Response.json({
      sid: `SM${"2".repeat(32)}`,
      status: "queued",
    });
  };
  try {
    const receipt = await sendProviderMessage(twilioSmsMessagingProvider, {
      tenantId,
      conversationId,
      messageId,
      channel: "SMS",
      recipientAddress: "+447700900123",
      subject: "Ignored for SMS",
      body: "Can we confirm your booking?",
      requestedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(
      request.input,
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    );
    assert.equal(
      request.init.headers.Authorization,
      `Basic ${Buffer.from(
        `${twilioAccountSid}:${twilioAuthToken}`,
      ).toString("base64")}`,
    );
    assert.deepEqual(
      Object.fromEntries(new URLSearchParams(request.init.body)),
      {
        Body: "Can we confirm your booking?",
        From: twilioFromNumber,
        To: "+447700900123",
      },
    );
    assert.equal(receipt.provider, "TWILIO");
    assert.equal(receipt.externalMessageId, `SM${"2".repeat(32)}`);
    assert.equal(receipt.status, "ACCEPTED");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Twilio provider rejects failures without exposing provider response content", async () => {
  const previousFetch = globalThis.fetch;
  configureTwilioRoutes([
    {
      tenantId,
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    },
  ]);
  globalThis.fetch = async () =>
    Response.json(
      {
        code: 21211,
        message: "The 'To' number is not a valid phone number.",
      },
      { status: 400 },
    );
  try {
    await assert.rejects(
      () =>
        sendProviderMessage(twilioSmsMessagingProvider, {
          tenantId,
          conversationId,
          messageId,
          channel: "SMS",
          recipientAddress: "+447700900123",
          subject: "Ignored",
          body: "Hello",
          requestedAt: "2026-01-01T00:00:00.000Z",
        }),
      (error) =>
        error?.category === "PROVIDER" &&
        error?.providerStatus === 400 &&
        error?.providerCode === 21211 &&
        !error.message.includes("valid phone number"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Twilio provider authenticates and tenant-routes inbound SMS", async () => {
  configureTwilioRoutes([
    {
      tenantId,
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    },
  ]);
  const rawBody = new URLSearchParams({
    AccountSid: twilioAccountSid,
    Body: "Can I move my booking?",
    From: "+447700900123",
    MessageSid: `SM${"3".repeat(32)}`,
    To: twilioFromNumber,
  }).toString();
  const url = "https://booksimple.app/api/webhooks/twilio/sms";
  const signature = twilioSignature(url, rawBody);
  const messages = await parseProviderWebhook(twilioSmsMessagingProvider, {
    rawBody,
    headers: { "x-twilio-signature": signature },
    url,
  });
  assert.equal(messages.length, 1);
  assert.deepEqual(
    {
      ...messages[0],
      receivedAt: undefined,
    },
    {
      provider: "TWILIO",
      tenantId,
      providerEventId: `SM${"3".repeat(32)}`,
      externalMessageId: `SM${"3".repeat(32)}`,
      channel: "SMS",
      senderAddress: "+447700900123",
      recipientAddress: twilioFromNumber,
      providerRouteKey: twilioFromNumber,
      body: "Can I move my booking?",
      receivedAt: undefined,
    },
  );
  assert.match(messages[0].receivedAt, /^\d{4}-\d{2}-\d{2}T/);

  await assert.rejects(() =>
    parseProviderWebhook(twilioSmsMessagingProvider, {
      rawBody,
      headers: { "x-twilio-signature": "invalid" },
      url,
    }),
  );
});

test("Twilio route configuration rejects tenant and destination ambiguity", async () => {
  configureTwilioRoutes([
    {
      tenantId,
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    },
    {
      tenantId,
      accountSid: `AC${"4".repeat(32)}`,
      authToken: "other-token",
      fromNumber: "+447700900998",
    },
  ]);
  await assert.rejects(
    () =>
      sendProviderMessage(twilioSmsMessagingProvider, {
        tenantId,
        conversationId,
        messageId,
        channel: "SMS",
        recipientAddress: "+447700900123",
        subject: "Ignored",
        body: "Hello",
        requestedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error?.category === "CONFIGURATION",
  );
});
