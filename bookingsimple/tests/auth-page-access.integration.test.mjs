import assert from "node:assert/strict";
import test from "node:test";
import { authFixture } from "./auth-integration-helpers.mjs";
import { controlContainer, readDocument, replaceDocument } from "../src/server/auth-storage.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

test("application pages require a valid session while sign-in and recovery remain public",
  { skip: !baseUrl }, async () => {
    const fixture = authFixture();
    const get = (path, token) => fetch(new URL(path, baseUrl), {
      redirect: "manual",
      headers: token ? { cookie: `booksimple_session=${token}` } : {},
    });
    try {
      for (const path of ["/login", "/register", "/verify", "/forgot-password", "/reset-password"]) {
        assert.equal((await get(path)).status, 200, `${path} should be public`);
      }
      for (const path of ["/", "/account", "/admin"]) {
        const response = await get(path);
        assert.equal(response.status, 307, `${path} should redirect`);
        assert.equal(new URL(response.headers.get("location"), baseUrl).pathname, "/login");
      }
      const forged = `account_${"0".repeat(64)}.${"0".repeat(32)}.${"A".repeat(43)}`;
      assert.equal((await get("/", forged)).status, 307);

      await fixture.registerAndVerify();
      const login = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      const dashboard = await get("/", login.sessionToken);
      assert.equal(dashboard.status, 307);
      assert.equal(new URL(dashboard.headers.get("location"), baseUrl).pathname, "/account");
      assert.equal((await get("/account", login.sessionToken)).status, 200);
      const admin = await get("/admin", login.sessionToken);
      assert.equal(admin.status, 307);
      assert.equal(new URL(admin.headers.get("location"), baseUrl).pathname, "/account");

      const saved = await fixture.user();
      const current = await readDocument(controlContainer(), "user", saved.partitionKey);
      await replaceDocument(controlContainer(), {
        ...current.document,
        platformAdmin: true,
        authVersion: current.document.authVersion + 1,
      }, current.etag);
      assert.equal((await get("/", login.sessionToken)).status, 307);
      const adminLogin = await fixture.action("login", {
        email: fixture.email,
        password: "Synthetic-only-Password-17!",
      });
      assert.equal((await get("/admin", adminLogin.sessionToken)).status, 200);
      await fixture.action("logout", {}, adminLogin.sessionToken);
      for (const path of ["/", "/account", "/admin"]) {
        assert.equal((await get(path, adminLogin.sessionToken)).status, 307, `${path} must reject revoked sessions`);
      }
    } finally {
      await fixture.cleanup();
    }
  });
