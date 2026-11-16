import assert from "node:assert/strict";
import test from "node:test";
import { Secret, TOTP } from "otpauth";
import { acceptedTotpStep, createTotp } from "../src/server/auth-totp.ts";

test("a valid authenticator token is accepted once per time step", () => {
  const timestamp = 1_800_000_000_000;
  const secret = new Secret({ size: 20 });
  const totp = createTotp(secret.base32, "test@example.invalid");
  const code = totp.generate({ timestamp });

  const acceptedStep = acceptedTotpStep(totp, code, -1, timestamp);
  assert.equal(acceptedStep, TOTP.counter({ timestamp, period: 30 }));
  assert.notEqual(acceptedStep, null);
  assert.equal(acceptedTotpStep(totp, code, acceptedStep, timestamp), null);
});

test("invalid and expired authenticator tokens are rejected", () => {
  const timestamp = 1_800_000_000_000;
  const secret = new Secret({ size: 20 });
  const totp = createTotp(secret.base32, "test@example.invalid");
  const code = totp.generate({ timestamp });

  assert.equal(acceptedTotpStep(totp, "000000", -1, timestamp), null);
  assert.equal(acceptedTotpStep(totp, code, -1, timestamp + 120_000), null);
});
