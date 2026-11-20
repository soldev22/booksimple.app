import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.RUNTIME_TEST_BASE_URL ?? "http://localhost:3100";

test("public sign-in renders with production security headers", async () => {
  const response = await fetch(`${baseUrl}/login`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Sign in/);
  assert.match(body, /Email address/);
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});
