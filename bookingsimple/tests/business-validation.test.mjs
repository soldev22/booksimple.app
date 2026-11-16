import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAcceptInvitationInput,
  parseBusinessUpdateInput,
  parseCreateInvitationInput,
} from "../src/server/business-validation.ts";

test("business settings accept explicit valid values", () => {
  assert.deepEqual(
    parseBusinessUpdateInput({
      name: "Example Business",
      timezone: "Europe/London",
      currency: "gbp",
    }),
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
    },
  );
});

test("business settings reject invalid or browser-supplied tenant data", () => {
  for (const input of [
    {
      name: "Example Business",
      timezone: "Not/A_Timezone",
      currency: "GBP",
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "INVALID",
    },
    {
      name: "Example Business",
      timezone: "Europe/London",
      currency: "GBP",
      tenantId: "22222222-2222-4222-8222-222222222222",
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

test("invitation acceptance requires a bounded opaque token", () => {
  const token = `${"1".repeat(36)}.${"a".repeat(75)}.${"A".repeat(43)}`;
  assert.deepEqual(parseAcceptInvitationInput({ token }), { token });
  assert.throws(() => parseAcceptInvitationInput({ token: "short" }));
});
