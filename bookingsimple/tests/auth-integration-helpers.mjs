import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accountPartition, parseSessionToken, sha256 } from "../src/server/auth-crypto.ts";
import { AUTH_COOKIE_NAME } from "../src/server/auth.ts";
import { runAuthAction } from "../src/server/auth-service.ts";
import { parseAuthInput } from "../src/server/auth-validation.ts";
import {
  controlContainer,
  deleteDocument,
  queryAllPages,
  readDocument,
  sessionContainer,
  throttleContainer,
} from "../src/server/auth-storage.ts";

export const integrationEnabled = process.env.AUTH_COSMOS_INTEGRATION_TESTS === "1";

export function authFixture() {
  const email = `auth-${randomUUID()}@example.invalid`;
  const partitionKey = accountPartition(email);
  const partitions = new Set([partitionKey]);
  const throttles = new Set();
  const messages = [];
  const originalFetch = globalThis.fetch;
  let failEmail = false;

  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://api.postmarkapp.com/email") {
      return originalFetch(url, options);
    }
    if (failEmail) return new Response("{}", { status: 503 });
    messages.push(JSON.parse(options.body));
    return Response.json({ ErrorCode: 0 });
  };

  function trackThrottle(scope, key) {
    throttles.add(`${scope}_${sha256(`${scope}\n${key}`)}`);
  }

  async function action(name, input, token) {
    const parsed = parseSessionToken(token ?? "");
    if (["register", "login", "resend-verification", "request-reset"].includes(name)) {
      trackThrottle(`email-${name}`, partitionKey);
    }
    const mfaAction = {
      "mfa-setup": "setup",
      "mfa-enable": "enable",
      mfa: "challenge",
      recovery: "recovery",
    }[name];
    if (mfaAction) {
      trackThrottle(`mfa-${mfaAction}`, partitionKey);
      if (parsed) trackThrottle(`mfa-${mfaAction}`, `${partitionKey}:${parsed.sessionId}`);
    }
    return runAuthAction(
      name,
      parseAuthInput(name, input),
      new Request(`http://localhost/api/auth/${name}`, {
        headers: token ? { cookie: `${AUTH_COOKIE_NAME}=${token}` } : {},
      }),
    );
  }

  async function user() {
    return (await readDocument(controlContainer(), "user", partitionKey))?.document;
  }

  function emailToken() {
    const message = messages.at(-1);
    assert.ok(message, "An email must have been submitted to the provider stub.");
    const link = message.TextBody.match(/https?:\/\/\S+/)?.[0];
    assert.ok(link, "The email must contain an action link.");
    const token = new URL(link).searchParams.get("token");
    assert.ok(token);
    return token;
  }

  async function registerAndVerify(businessName) {
    const result = await action("register", {
      name: "Synthetic Test User",
      email,
      password: "Synthetic-only-Password-17!",
      ...(businessName ? { businessName } : {}),
    });
    assert.equal(result.status, 201);
    const saved = await user();
    if (saved.application) partitions.add(saved.application.businessId);
    const token = emailToken();
    assert.equal((await action("verify", { token })).status, 200);
    return token;
  }

  async function cleanup() {
    globalThis.fetch = originalFetch;
    const saved = await user();
    if (saved?.application) partitions.add(saved.application.businessId);
    for (const key of partitions) {
      for (const container of [controlContainer(), sessionContainer()]) {
        const documents = await queryAllPages(
          container,
          "SELECT c.id FROM c WHERE c.partitionKey = @key",
          [{ name: "@key", value: key }],
        );
        for (const document of documents) await deleteDocument(container, document.id, key);
      }
    }
    for (const key of throttles) {
      if (await readDocument(throttleContainer(), key, key)) {
        await deleteDocument(throttleContainer(), key, key);
      }
    }
  }

  return {
    email,
    action,
    user,
    emailToken,
    registerAndVerify,
    cleanup,
    failEmail: () => { failEmail = true; },
    restoreEmail: () => { failEmail = false; },
  };
}
