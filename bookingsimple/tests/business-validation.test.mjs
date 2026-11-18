import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAcceptInvitationInput,
  parseBusinessUpdateInput,
  parseCreateInvitationInput,
  parseDeleteInvitationInput,
} from "../src/server/business-validation.ts";

test("business settings accept explicit valid values", () => {
  assert.deepEqual(
    parseBusinessUpdateInput({
      name: "Example Business",
      timezone: "Europe/London",
      currency: "gbp",
      defaultDepositPercentage: "25",
      reminderRules: JSON.stringify([
        { channel: "EMAIL", offsetMinutes: 1440 },
        { channel: "SMS", offsetMinutes: 120 },
      ]),
    }),
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 25,
      reminderRules: [
        {
          id: "email-1440",
          channel: "EMAIL",
          offsetMinutes: 1440,
        },
        {
          id: "sms-120",
          channel: "SMS",
          offsetMinutes: 120,
        },
      ],
    },
  );
});

test("business settings reject invalid or browser-supplied tenant data", () => {
  for (const input of [
    {
      name: "Example Business",
      timezone: "Not/A_Timezone",
      currency: "GBP",
      defaultDepositPercentage: 25,
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "INVALID",
      defaultDepositPercentage: 25,
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 25,
      tenantId: "22222222-2222-4222-8222-222222222222",
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: -1,
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 101,
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 25,
      reminderRules: [
        { channel: "EMAIL", offsetMinutes: 1440 },
        { channel: "EMAIL", offsetMinutes: 1440 },
      ],
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      defaultDepositPercentage: 25,
      reminderRules: [
        { channel: "EMAIL", offsetMinutes: 0 },
      ],
    },
  ]) {
    assert.throws(() => parseBusinessUpdateInput(input));
  }
});

test("company invitations accept only an email and normalize it", () => {
  assert.deepEqual(
    parseCreateInvitationInput({ email: " Staff@Example.com " }),
    { email: "staff@example.com" },
  );
  assert.throws(() =>
    parseCreateInvitationInput({
      email: "staff@example.com",
      role: "company_admin",
    }),
  );
});

test("invitation deletion accepts only the normalized invitee email", () => {
  assert.deepEqual(
    parseDeleteInvitationInput({ email: " Wrong@Example.com " }),
    { email: "wrong@example.com" },
  );
  assert.throws(() =>
    parseDeleteInvitationInput({
      email: "wrong@example.com",
      tenantId: "22222222-2222-4222-8222-222222222222",
    }),
  );
});

test("invitation acceptance requires a bounded opaque token", () => {
  const token = `${"1".repeat(36)}.${"a".repeat(75)}.${"A".repeat(43)}`;
  assert.deepEqual(parseAcceptInvitationInput({ token }), { token });
  assert.throws(() => parseAcceptInvitationInput({ token: "short" }));
});
