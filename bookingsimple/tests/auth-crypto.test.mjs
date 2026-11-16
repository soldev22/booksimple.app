import assert from "node:assert/strict";
import test from "node:test";
import {
  accountPartition,
  hashPassword,
  parseSessionToken,
  verifyPassword,
} from "../src/server/auth-crypto.ts";

test("email account partition keys are deterministic and case-insensitive", () => {
  assert.equal(
    accountPartition("Person@Example.invalid"),
    accountPartition(" person@example.invalid "),
  );
  assert.notEqual(
    accountPartition("first@example.invalid"),
    accountPartition("second@example.invalid"),
  );
});

test("passwords use salted scrypt verifiers and reject incorrect credentials", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("incorrect password", first), false);
  assert.equal(await verifyPassword("correct horse battery staple", "plain-text"), false);
});

test("session token parser accepts only the opaque high-entropy format", () => {
  const token = `account_${"a".repeat(64)}.${"b".repeat(32)}.${"c".repeat(43)}`;
  assert.deepEqual(parseSessionToken(token), {
    accountKey: `account_${"a".repeat(64)}`,
    sessionId: "b".repeat(32),
    token,
  });
  assert.equal(parseSessionToken("account_global.session.secret"), null);
  assert.equal(parseSessionToken(`${token}x`.repeat(5)), null);
});
