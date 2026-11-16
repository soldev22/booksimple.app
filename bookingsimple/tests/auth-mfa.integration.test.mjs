import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionToken } from "../src/server/auth.ts";
import { createTotp } from "../src/server/auth-totp.ts";
import { authFixture, integrationEnabled } from "./auth-integration-helpers.mjs";

test("MFA enrollment verifies a code, blocks its replay, and consumes backup codes exactly once",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      await fixture.registerAndVerify();
      const credentials = { email: fixture.email, password: "Synthetic-only-Password-17!" };
      const login = await fixture.action("login", credentials);
      const setup = await fixture.action("mfa-setup", {}, login.sessionToken);
      const code = createTotp(setup.body.secret, fixture.email).generate();
      const enrolled = await fixture.action("mfa-enable", { code }, login.sessionToken);
      assert.equal(enrolled.body.backupCodes.length, 10);
      const saved = await fixture.user();
      assert.equal(saved.mfaEnabled, true);
      assert.notEqual(saved.mfaSecret, setup.body.secret);
      assert.ok(saved.backupCodeHashes.every((hash) => !enrolled.body.backupCodes.includes(hash)));
      const challenge = await fixture.action("login", credentials);
      await assert.rejects(fixture.action("mfa", { code }, challenge.sessionToken), { status: 401 });
      const recovered = await fixture.action("recovery", {
        code: enrolled.body.backupCodes[0],
      }, challenge.sessionToken);
      assert.equal((await resolveSessionToken(recovered.sessionToken)).session.document.mfaVerified, true);
      assert.equal(await resolveSessionToken(challenge.sessionToken), null);
      const nextChallenge = await fixture.action("login", credentials);
      await assert.rejects(fixture.action("recovery", {
        code: enrolled.body.backupCodes[0],
      }, nextChallenge.sessionToken), { status: 401 });
      assert.equal((await fixture.user()).backupCodeHashes.length, 9);
    } finally {
      await fixture.cleanup();
    }
  });
