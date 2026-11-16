import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionToken } from "../src/server/auth.ts";
import { authFixture, integrationEnabled } from "./auth-integration-helpers.mjs";

test("password reset is single-use, changes credentials, and invalidates existing sessions; logout revokes the replacement",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      await fixture.registerAndVerify();
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.ok(await resolveSessionToken(login.sessionToken));
      assert.equal((await fixture.action("request-reset", { email: fixture.email })).status, 200);
      const token = fixture.emailToken();
      const resetInput = { token, password: "Replacement-Synthetic-Password-24!" };
      assert.equal((await fixture.action("reset", resetInput)).status, 200);
      assert.equal(await resolveSessionToken(login.sessionToken), null);
      await assert.rejects(fixture.action("reset", resetInput), { status: 400 });
      await assert.rejects(fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      }), { status: 401 });
      const replacement = await fixture.action("login", {
        email: fixture.email,
        password: resetInput.password,
      });
      assert.ok(await resolveSessionToken(replacement.sessionToken));
      assert.equal((await fixture.action("logout", {}, replacement.sessionToken)).clearCookie, true);
      assert.equal(await resolveSessionToken(replacement.sessionToken), null);
    } finally {
      await fixture.cleanup();
    }
  });
