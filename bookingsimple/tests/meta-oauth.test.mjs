import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  AUTH_COOKIE_NAME,
  createSession,
} from "../src/server/auth.ts";
import { accountPartition, sha256 } from "../src/server/auth-crypto.ts";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  sessionContainer,
} from "../src/server/auth-storage.ts";
import { parseMetaOAuthConfig } from "../src/server/meta-connection-config.ts";
import {
  completeMetaOAuthConnection,
  createMetaOAuthLink,
  disconnectMetaPage,
  getMetaManagedPages,
  metaRouteForTenant,
  selectMetaManagedPage,
} from "../src/server/meta-connection-service.ts";
import {
  buildMetaOAuthAuthorizeUrl,
  parseMetaOAuthCallback,
} from "../src/server/meta-oauth.ts";

const baseUrl = process.env.AUTH_PAGE_TEST_BASE_URL;

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function metaEnvironment() {
  return {
    APP_ORIGIN: "https://www.booksimple.app",
    META_APP_ID: "1107457082126396",
    META_APP_SECRET: "meta-app-secret-for-tests",
    META_WEBHOOK_VERIFY_TOKEN: "meta-webhook-verify-token",
    META_GRAPH_API_VERSION: "v27.0",
    META_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}

test("Meta OAuth configuration and callbacks are strict", () => {
  const config = parseMetaOAuthConfig(metaEnvironment());
  assert.equal(
    config.oauthRedirectUri,
    "https://www.booksimple.app/api/meta/connect/oauth/callback",
  );
  const state = "a".repeat(43);
  const authorization = new URL(buildMetaOAuthAuthorizeUrl(config, state));
  assert.equal(authorization.hostname, "www.facebook.com");
  assert.equal(authorization.searchParams.get("state"), state);
  assert.deepEqual(
    authorization.searchParams.get("scope").split(","),
    [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_messaging",
      "business_management",
    ],
  );
  assert.deepEqual(
    parseMetaOAuthCallback(
      new URL(
        `${config.oauthRedirectUri}?state=${state}&code=authorization-code`,
      ),
    ),
    {
      outcome: "AUTHORIZED",
      state,
      code: "authorization-code",
    },
  );
  assert.deepEqual(
    parseMetaOAuthCallback(
      new URL(
        `${config.oauthRedirectUri}?state=${state}&error=access_denied`,
      ),
    ),
    { outcome: "DENIED", state },
  );
  assert.throws(() =>
    parseMetaOAuthConfig({
      ...metaEnvironment(),
      META_TOKEN_ENCRYPTION_KEY: "not-a-key",
    }),
  );
});

test(
  "Meta Page connection is tenant-admin scoped and keeps tokens server-side",
  { skip: !baseUrl },
  async () => {
    const tenantId = randomUUID();
    const adminEmail = `meta-admin-${randomUUID()}@example.invalid`;
    const userEmail = `meta-user-${randomUUID()}@example.invalid`;
    const now = new Date().toISOString();
    const users = [
      {
        id: "user",
        userId: randomUUID(),
        partitionKey: accountPartition(adminEmail),
        type: "user",
        schemaVersion: 1,
        email: adminEmail,
        name: "Meta Administrator",
        status: "active",
        passwordHash: "synthetic-only",
        emailVerified: true,
        platformAdmin: false,
        authVersion: 1,
        createdAt: now,
        updatedAt: now,
        mfaEnabled: false,
        membership: {
          tenantId,
          username: `meta-admin-${randomUUID().slice(0, 8)}`,
          role: "company_admin",
        },
      },
      {
        id: "user",
        userId: randomUUID(),
        partitionKey: accountPartition(userEmail),
        type: "user",
        schemaVersion: 1,
        email: userEmail,
        name: "Meta User",
        status: "active",
        passwordHash: "synthetic-only",
        emailVerified: true,
        platformAdmin: false,
        authVersion: 1,
        createdAt: now,
        updatedAt: now,
        mfaEnabled: false,
        membership: {
          tenantId,
          username: `meta-user-${randomUUID().slice(0, 8)}`,
          role: "company_user",
        },
      },
    ];
    const previousEnvironment = Object.fromEntries(
      [
        "APP_ORIGIN",
        "META_APP_ID",
        "META_APP_SECRET",
        "META_WEBHOOK_VERIFY_TOKEN",
        "META_GRAPH_API_VERSION",
        "META_TOKEN_ENCRYPTION_KEY",
        "META_MESSENGER_ROUTES",
      ].map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, metaEnvironment(), {
      META_MESSENGER_ROUTES: "",
    });
    const previousFetch = globalThis.fetch;
    const sessions = [];
    const states = [];
    const request = (token, url = "https://www.booksimple.app/settings") =>
      new Request(url, {
        headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` },
      });

    try {
      await createDocument(controlContainer(), {
        id: tenantId,
        partitionKey: tenantId,
        type: "business",
        schemaVersion: 1,
        name: "Meta test company",
        status: "active",
        memberCount: 2,
        timezone: "Europe/London",
        currency: "GBP",
        createdAt: now,
        updatedAt: now,
      });
      for (const user of users) {
        await createDocument(controlContainer(), user);
        sessions.push(await createSession(user, false));
      }
      const [adminSession, userSession] = sessions;

      await assert.rejects(
        () => createMetaOAuthLink(request(userSession.token)),
        (error) => error.status === 403,
      );
      const oauth = await createMetaOAuthLink(request(adminSession.token));
      const authorization = new URL(oauth.url);
      const state = authorization.searchParams.get("state");
      states.push(state);
      assert.match(state, /^[A-Za-z0-9_-]{43}$/);

      let fetchCall = 0;
      const subscriptionCalls = [];
      globalThis.fetch = async (input, init = {}) => {
        fetchCall += 1;
        const url = new URL(String(input));
        if (url.pathname === "/v27.0/oauth/access_token") {
          if (url.searchParams.get("grant_type") === "fb_exchange_token") {
            return Response.json({
              access_token: "long-lived-user-access-token",
              token_type: "bearer",
            });
          }
          assert.equal(url.pathname, "/v27.0/oauth/access_token");
          return Response.json({
            access_token: "short-lived-user-access-token",
            token_type: "bearer",
          });
        }
        if (url.pathname === "/v27.0/me/accounts") {
          assert.equal(
            init.headers.Authorization,
            "Bearer long-lived-user-access-token",
          );
          return Response.json({
            data: [
              {
                id: "123456789012345",
                name: "Meta Test Page",
                access_token: "managed-page-access-token",
                tasks: ["MESSAGING", "MODERATE"],
              },
              {
                id: "223456789012345",
                name: "Second Meta Test Page",
                access_token: "second-managed-page-access-token",
                tasks: ["MESSAGING", "MODERATE"],
              },
            ],
          });
        }
        assert.match(url.pathname, /^\/v27\.0\/\d+\/subscribed_apps$/);
        if (init.method === "POST") {
          assert.equal(
            url.searchParams.get("subscribed_fields"),
            "messages,messaging_postbacks",
          );
        }
        subscriptionCalls.push({
          method: init.method,
          pageId: url.pathname.split("/")[2],
        });
        return Response.json({ success: true });
      };

      const callbackUrl =
        `https://www.booksimple.app/api/meta/connect/oauth/callback` +
        `?state=${state}&code=authorization-code`;
      assert.deepEqual(
        await completeMetaOAuthConnection(
          new Request(callbackUrl),
        ),
        { outcome: "SELECT_PAGE", state },
      );
      const selection = await getMetaManagedPages(
        request(adminSession.token),
        state,
      );
      assert.deepEqual(selection.pages, [
        { id: "123456789012345", name: "Meta Test Page" },
        { id: "223456789012345", name: "Second Meta Test Page" },
      ]);
      assert.equal(JSON.stringify(selection).includes("access-token"), false);

      const connected = await selectMetaManagedPage(
        request(adminSession.token),
        { state, pageId: "123456789012345" },
      );
      assert.equal(connected.status, "CONNECTED");
      assert.equal(connected.pageName, "Meta Test Page");
      const route = await metaRouteForTenant(tenantId);
      assert.equal(route.pageAccessToken, "managed-page-access-token");
      assert.equal(fetchCall, 4);

      const reconnect = await createMetaOAuthLink(
        request(adminSession.token),
      );
      const reconnectState = new URL(reconnect.url).searchParams.get("state");
      states.push(reconnectState);
      const reconnectCallbackUrl =
        `https://www.booksimple.app/api/meta/connect/oauth/callback` +
        `?state=${reconnectState}&code=reconnect-authorization-code`;
      await completeMetaOAuthConnection(
        new Request(reconnectCallbackUrl),
      );
      const reconnected = await selectMetaManagedPage(
        request(adminSession.token),
        { state: reconnectState, pageId: "223456789012345" },
      );
      assert.equal(reconnected.pageName, "Second Meta Test Page");
      assert.deepEqual(subscriptionCalls, [
        { method: "POST", pageId: "123456789012345" },
        { method: "POST", pageId: "223456789012345" },
        { method: "DELETE", pageId: "123456789012345" },
      ]);

      const disconnected = await disconnectMetaPage(
        request(adminSession.token),
      );
      assert.equal(disconnected.status, "NOT_CONNECTED");
      assert.deepEqual(subscriptionCalls.at(-1), {
        method: "DELETE",
        pageId: "223456789012345",
      });
      assert.equal(fetchCall, 10);
    } finally {
      globalThis.fetch = previousFetch;
      for (const [name, value] of Object.entries(previousEnvironment)) {
        restoreEnvironment(name, value);
      }
      await deleteDocument(
        controlContainer(),
        "meta-messenger-connection",
        tenantId,
      ).catch(() => {});
      for (const state of states) {
        const id = `meta-oauth-state-${sha256(state)}`;
        await deleteDocument(controlContainer(), id, id).catch(() => {});
      }
      for (const session of sessions) {
        await deleteDocument(
          sessionContainer(),
          session.document.id,
          session.document.partitionKey,
        ).catch(() => {});
      }
      for (const user of users) {
        await deleteDocument(
          controlContainer(),
          user.id,
          user.partitionKey,
        ).catch(() => {});
      }
      await deleteDocument(controlContainer(), tenantId, tenantId).catch(
        () => {},
      );
    }
  },
);
