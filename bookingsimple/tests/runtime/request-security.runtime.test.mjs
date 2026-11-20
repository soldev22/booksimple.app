import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.RUNTIME_TEST_BASE_URL ?? "http://localhost:3100";

test("authentication mutations reject cross-origin and unsupported requests", async () => {
  const crossOrigin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.invalid",
    },
    body: JSON.stringify({ email: "test@example.com", password: "not-a-secret" }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), {
    error: "The request origin is not allowed.",
  });

  const unsupported = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
    },
    body: "{",
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(await unsupported.json(), {
    error: "Content-Type must be application/json.",
  });
});
