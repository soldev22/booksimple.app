import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionToken } from "../src/server/auth.ts";
import { controlContainer, readDocument, replaceDocument } from "../src/server/auth-storage.ts";
import { authFixture, integrationEnabled } from "./auth-integration-helpers.mjs";

test("registration persists without privileges, verification is one-time, and login requires valid credentials",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      const verification = await fixture.registerAndVerify("Synthetic test business");
      const user = await fixture.user();
      assert.equal(user.emailVerified, true);
      assert.equal(user.platformAdmin, false);
      assert.equal(user.membership, undefined);
      assert.equal(user.application.status, "pending");
      await assert.rejects(fixture.action("verify", { token: verification }), { status: 400 });
      await assert.rejects(fixture.action("login", { email: fixture.email, password: "wrong" }), { status: 401 });
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.equal(login.status, 200);
      const session = await resolveSessionToken(login.sessionToken);
      assert.equal(session.user.document.userId, user.userId);
      assert.equal(session.session.document.mfaVerified, false);
    } finally {
      await fixture.cleanup();
    }
  });

test("login with the correct password prompts for email verification",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      const registration = await fixture.action("register", {
        name: "Synthetic Test User",
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.equal(registration.status, 201);

      await assert.rejects(
        fixture.action("login", {
          email: fixture.email,
          password: "wrong",
        }),
        { status: 401, message: "The email or password is incorrect." },
      );
      await assert.rejects(
        fixture.action("login", {
          email: fixture.email,
          password: "Synthetic-only-Password-17!",
        }),
        { status: 403, message: "Please verify your email to proceed." },
      );

      await fixture.action("verify", { token: fixture.emailToken() });
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.equal(login.status, 200);
      assert.ok(await resolveSessionToken(login.sessionToken));
    } finally {
      await fixture.cleanup();
    }
  });

test("previous MFA enrollment does not request an authenticator at login",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      await fixture.registerAndVerify();
      const saved = await fixture.user();
      const current = await readDocument(controlContainer(), "user", saved.partitionKey);
      await replaceDocument(controlContainer(), { ...current.document, mfaEnabled: true }, current.etag);
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.equal(login.body.message, "Signed in.");
      assert.equal(login.body.redirect, "/account");
      assert.ok(await resolveSessionToken(login.sessionToken));
    } finally {
      await fixture.cleanup();
    }
  });

test("failed verification email leaves a recoverable account and resend succeeds",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      fixture.failEmail();
      await assert.rejects(fixture.action("register", {
        name: "Synthetic Test User",
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      }), { status: 503 });
      assert.equal((await fixture.user()).emailVerified, false);
      await assert.rejects(fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      }), { status: 401 });
      fixture.restoreEmail();
      assert.equal((await fixture.action("resend-verification", { email: fixture.email })).status, 200);
      assert.equal((await fixture.action("verify", { token: fixture.emailToken() })).status, 200);
      assert.equal((await fixture.user()).emailVerified, true);
    } finally {
      await fixture.cleanup();
    }
  });
