import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.RUNTIME_TEST_BASE_URL ?? "http://localhost:3100";

test("an unauthenticated workspace request returns to sign-in", async () => {
  const protectedResponse = await fetch(`${baseUrl}/`, {
    redirect: "manual",
  });
  assert.equal(protectedResponse.status, 307);
  assert.equal(protectedResponse.headers.get("location"), "/login");

  const signInResponse = await fetch(
    new URL(protectedResponse.headers.get("location"), baseUrl),
  );
  const body = await signInResponse.text();
  assert.equal(signInResponse.status, 200);
  assert.match(body, /Use your email address and password/);
});
