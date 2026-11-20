import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { AUTH_COOKIE_NAME, resolveSessionToken } from "../src/server/auth.ts";
import { sha256 } from "../src/server/auth-crypto.ts";
import { runAdminAction } from "../src/server/auth-service.ts";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  queryAllPages,
  readDocument,
  replaceDocument,
} from "../src/server/auth-storage.ts";
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

test("business approval assigns company user until a platform administrator elevates the role",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      await fixture.registerAndVerify("Least privilege test business");
      const registered = await fixture.user();
      const current = await readDocument(
        controlContainer(),
        "user",
        registered.partitionKey,
      );
      await replaceDocument(controlContainer(), {
        ...current.document,
        platformAdmin: true,
        authVersion: current.document.authVersion + 1,
      }, current.etag);
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      const request = new Request("http://localhost/api/admin/approve", {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${login.sessionToken}`,
        },
      });

      await runAdminAction("approve", { userId: registered.userId }, request);
      const approved = await fixture.user();
      assert.equal(approved.membership.role, "company_user");
      assert.equal(approved.application.status, "approved");
      assert.equal(await resolveSessionToken(login.sessionToken), null);

      const elevatedLogin = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      await runAdminAction("assign", {
        userId: registered.userId,
        tenantId: approved.membership.tenantId,
        username: approved.membership.username,
        role: "company_admin",
      }, new Request("http://localhost/api/admin/assign", {
        headers: {
          cookie: `${AUTH_COOKIE_NAME}=${elevatedLogin.sessionToken}`,
        },
      }));
      assert.equal((await fixture.user()).membership.role, "company_admin");
    } finally {
      await fixture.cleanup();
    }
  });

test("a rejected applicant can correct and resubmit the same business application",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    try {
      await fixture.registerAndVerify("Original application name");
      const registered = await fixture.user();
      const currentUser = await readDocument(
        controlContainer(),
        "user",
        registered.partitionKey,
      );
      const currentBusiness = await readDocument(
        controlContainer(),
        registered.application.businessId,
        registered.application.businessId,
      );
      await replaceDocument(controlContainer(), {
        ...currentUser.document,
        application: {
          ...currentUser.document.application,
          status: "rejected",
        },
      }, currentUser.etag);
      await replaceDocument(controlContainer(), {
        ...currentBusiness.document,
        status: "rejected",
      }, currentBusiness.etag);
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });

      const result = await fixture.action(
        "resubmit-application",
        { businessName: "Corrected application name" },
        login.sessionToken,
      );

      assert.equal(result.status, 200);
      const resubmitted = await fixture.user();
      assert.equal(resubmitted.application.status, "pending");
      assert.equal(
        resubmitted.application.businessName,
        "Corrected application name",
      );
      const business = await readDocument(
        controlContainer(),
        registered.application.businessId,
        registered.application.businessId,
      );
      assert.equal(business.document.status, "pending");
      assert.equal(business.document.name, "Corrected application name");
    } finally {
      await fixture.cleanup();
    }
  });

test("registration records invitation consent and verification accepts the company membership",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    const tenantId = randomUUID();
    const invitationId = `invitation_${sha256(fixture.email)}`;
    const invitationToken = `${tenantId}.${invitationId}.${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    try {
      await createDocument(controlContainer(), {
        id: tenantId,
        partitionKey: tenantId,
        type: "business",
        schemaVersion: 1,
        name: "Invitation registration business",
        status: "active",
        memberCount: 0,
        timezone: "Europe/London",
        currency: "GBP",
        createdAt: now,
        updatedAt: now,
      });
      await createDocument(controlContainer(), {
        id: invitationId,
        partitionKey: tenantId,
        type: "business-invitation",
        schemaVersion: 1,
        email: fixture.email,
        role: "company_user",
        status: "pending",
        tokenHash: sha256(invitationToken),
        invitedByUserId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

      await fixture.action("register", {
        name: "Invited Synthetic User",
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
        invitationToken,
      });
      const verificationLink = fixture.emailLink();
      assert.equal(
        verificationLink.searchParams.get("invitation"),
        invitationToken,
      );
      await fixture.action("verify", {
        token: verificationLink.searchParams.get("token"),
        invitationToken,
      });

      const user = await fixture.user();
      assert.equal(user.emailVerified, true);
      assert.equal(user.membership.tenantId, tenantId);
      assert.equal(user.membership.role, "company_user");
      const invitation = await readDocument(
        controlContainer(),
        invitationId,
        tenantId,
      );
      assert.equal(invitation.document.status, "accepted");
      assert.equal(invitation.document.acceptedByUserId, user.userId);
    } finally {
      await fixture.cleanup();
      const tenantDocuments = await queryAllPages(
        controlContainer(),
        "SELECT c.id FROM c WHERE c.partitionKey = @tenantId",
        [{ name: "@tenantId", value: tenantId }],
      );
      for (const document of tenantDocuments) {
        await deleteDocument(controlContainer(), document.id, tenantId);
      }
    }
  });

test("an existing account accepts an invitation automatically during sign-in",
  { skip: !integrationEnabled }, async () => {
    const fixture = authFixture();
    const tenantId = randomUUID();
    const invitationId = `invitation_${sha256(fixture.email)}`;
    const invitationToken = `${tenantId}.${invitationId}.${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    try {
      await fixture.registerAndVerify();
      await createDocument(controlContainer(), {
        id: tenantId,
        partitionKey: tenantId,
        type: "business",
        schemaVersion: 1,
        name: "Existing account invitation business",
        status: "active",
        memberCount: 0,
        timezone: "Europe/London",
        currency: "GBP",
        createdAt: now,
        updatedAt: now,
      });
      await createDocument(controlContainer(), {
        id: invitationId,
        partitionKey: tenantId,
        type: "business-invitation",
        schemaVersion: 1,
        email: fixture.email,
        role: "company_user",
        status: "pending",
        tokenHash: sha256(invitationToken),
        invitedByUserId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
        invitationToken,
      });

      const user = await fixture.user();
      assert.equal(user.membership.tenantId, tenantId);
      assert.equal(user.membership.role, "company_user");
      assert.ok(await resolveSessionToken(login.sessionToken));
      const invitation = await readDocument(
        controlContainer(),
        invitationId,
        tenantId,
      );
      assert.equal(invitation.document.status, "accepted");
      assert.equal(invitation.document.acceptedByUserId, user.userId);
    } finally {
      await fixture.cleanup();
      const tenantDocuments = await queryAllPages(
        controlContainer(),
        "SELECT c.id FROM c WHERE c.partitionKey = @tenantId",
        [{ name: "@tenantId", value: tenantId }],
      );
      for (const document of tenantDocuments) {
        await deleteDocument(controlContainer(), document.id, tenantId);
      }
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
      assert.equal(login.body.redirect, "/");
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
