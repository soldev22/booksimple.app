import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConversationId,
  parseConversationArchiveInput,
  parseConversationListInput,
  parseCreateConversationInput,
  parseCreateMessageInput,
  parseLinkCustomerInput,
  parseMessageListInput,
} from "../src/server/conversation-validation.ts";

test("Conversation input normalizes channel addresses", () => {
  assert.deepEqual(
    parseCreateConversationInput({
      channel: "EMAIL",
      contactValue: " Alex@Example.com ",
      contactLabel: " Alex ",
      initialMessage: " Hello ",
      direction: "INBOUND",
    }),
    {
      channel: "EMAIL",
      normalizedContact: "alex@example.com",
      contactLabel: "Alex",
      initialMessage: "Hello",
      direction: "INBOUND",
    },
  );
  assert.deepEqual(
    parseCreateConversationInput({
      channel: "FACEBOOK",
      contactValue: "987654321098765",
      contactLabel: "Facebook contact",
      initialMessage: "Hello from the Page",
      direction: "INBOUND",
    }),
    {
      channel: "FACEBOOK",
      normalizedContact: "987654321098765",
      contactLabel: "Facebook contact",
      initialMessage: "Hello from the Page",
      direction: "INBOUND",
    },
  );
  assert.deepEqual(
    parseCreateConversationInput({
      channel: "WHATSAPP",
      contactValue: "+44 (7700) 900123",
      contactLabel: "",
      initialMessage: "Availability?",
      direction: "OUTBOUND",
    }),
    {
      channel: "WHATSAPP",
      normalizedContact: "+447700900123",
      contactLabel: "+44 (7700) 900123",
      initialMessage: "Availability?",
      direction: "OUTBOUND",
    },
  );
});

test("Conversation input is strict and validates channel-specific addresses", () => {
  const base = {
    channel: "EMAIL",
    contactValue: "alex@example.com",
    initialMessage: "Hello",
    direction: "INBOUND",
  };
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      tenantId: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({ ...base, contactValue: "not-an-email" }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      channel: "SMS",
      contactValue: "123",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      channel: "SMS",
      contactValue: "07700900123",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      channel: "WHATSAPP",
      contactValue: "07700900123",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      channel: "FACEBOOK",
      contactValue: "not-a-psid",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      channel: "FACEBOOK",
      contactValue: "987654321098765",
      direction: "OUTBOUND",
    }),
  );
  assert.throws(() =>
    parseCreateConversationInput({
      ...base,
      initialMessage: "x".repeat(4_001),
    }),
  );
});

test("Message, linking and paging inputs are strictly validated", () => {
  assert.deepEqual(
    parseCreateMessageInput({
      body: " Reply ",
      direction: "OUTBOUND",
      requestId: "11111111-1111-4111-8111-111111111111",
    }),
    {
      body: "Reply",
      direction: "OUTBOUND",
      requestId: "11111111-1111-4111-8111-111111111111",
    },
  );
  assert.throws(() =>
    parseCreateMessageInput({ body: "Reply", direction: "OUTBOUND" }),
  );
  assert.throws(() =>
    parseCreateMessageInput({
      body: "Reply",
      direction: "OUTBOUND",
      deliveryStatus: "DELIVERED",
    }),
  );
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseConversationId(id), id);
  assert.deepEqual(parseLinkCustomerInput({ customerId: id }), {
    customerId: id,
  });
  assert.throws(() => parseLinkCustomerInput({ customerId: id, tenantId: id }));
  assert.deepEqual(
    parseConversationListInput(
      new URLSearchParams({ search: " alex ", pageSize: "25" }),
    ),
    {
      search: "alex",
      continuationToken: undefined,
      pageSize: 25,
      archive: "active",
    },
  );
  assert.equal(
    parseConversationListInput(
      new URLSearchParams({ archive: "archived" }),
    ).archive,
    "archived",
  );
  assert.deepEqual(parseMessageListInput(new URLSearchParams()), {
    messageContinuationToken: undefined,
    messagePageSize: 50,
  });
  assert.throws(() =>
    parseMessageListInput(
      new URLSearchParams({ messagePageSize: "101" }),
    ),
  );
});

test("Conversation archive actions accept only explicit archive state", () => {
  assert.deepEqual(parseConversationArchiveInput({ archived: true }), {
    archived: true,
  });
  assert.deepEqual(parseConversationArchiveInput({ archived: false }), {
    archived: false,
  });
  assert.throws(() => parseConversationArchiveInput({ archived: "true" }));
  assert.throws(() =>
    parseConversationArchiveInput({ archived: true, tenantId: "injected" }),
  );
});
