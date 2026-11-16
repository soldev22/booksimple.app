import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthInput } from "../src/server/auth-validation.ts";

test("registration accepts the UI's empty optional business-name field", () => {
  const parsed = parseAuthInput("register", {
    name: "Account Owner",
    email: "OWNER@example.invalid",
    password: "a sufficiently long password",
    businessName: "",
  });
  assert.equal(parsed.email, "owner@example.invalid");
  assert.equal(parsed.businessName, undefined);
});

test("registration rejects unexpected fields and short passwords", () => {
  assert.throws(() =>
    parseAuthInput("register", {
      name: "Account Owner",
      email: "owner@example.invalid",
      password: "short",
      role: "platform_admin",
    }),
  );
});

test("company usernames accept the UI's bounded 50-character range", () => {
  const parsed = parseAuthInput("assign", {
    userId: "e5890609-3afb-4a14-8492-6d396c1a7457",
    tenantId: "6f3a5b88-bf3c-4c43-b97a-94736c17a883",
    username: "u".repeat(50),
    role: "company_user",
  });
  assert.equal(parsed.username.length, 50);
});
