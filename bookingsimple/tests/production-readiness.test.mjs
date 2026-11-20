import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";

test("all application routes receive the reviewed security headers", async () => {
  const config = nextConfig.default ?? nextConfig;
  assert.equal(typeof config.headers, "function");
  const rules = await config.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, "/:path*");
  const headers = new Map(
    rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  for (const key of [
    "content-security-policy",
    "cross-origin-opener-policy",
    "permissions-policy",
    "referrer-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
  ]) {
    assert.ok(headers.has(key), `missing ${key}`);
  }
  assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
});
