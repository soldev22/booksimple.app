import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAssignableToTenant,
  isExpired,
  isFreshTotpStep,
  requirePlatformAccess,
} from "../src/server/auth-policy.ts";
import { getSafeError } from "../src/server/auth-service.ts";
import { StorageError } from "../src/server/auth-storage.ts";
import { POST as authPost } from "../src/app/api/auth/[action]/route.ts";

test("safe error handling preserves request statuses and logs no raw error data", () => {
  const logged = [];
  const originalError = console.error;
  console.error = (message) => logged.push(String(message));
  try {
    const requestError = Object.assign(
      new Error("Request body must be valid JSON."),
      { status: 400 },
    );
    assert.deepEqual(getSafeError(requestError), {
      status: 400,
      message: "Request body must be valid JSON.",
    });

    const storageError = new StorageError("private provider token", 503);
    assert.deepEqual(getSafeError(storageError), {
      status: 503,
      message: "The request could not be completed.",
    });
    assert.equal(logged.length, 1);
    assert.deepEqual(JSON.parse(logged[0]), {
      event: "auth-operation-failed",
      category: "storage",
      status: 503,
    });
    assert.equal(logged[0].includes("private provider token"), false);
  } finally {
    console.error = originalError;
  }
});

test("expiring credentials fail closed for expired and invalid dates", () => {
  assert.equal(isExpired("2025-01-01T00:00:00.000Z", Date.parse("2025-01-02T00:00:00Z")), true);
  assert.equal(isExpired("not-a-date", Date.now()), true);
  assert.equal(isExpired("2027-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00Z")), false);
});

test("TOTP steps cannot be replayed or accepted out of order", () => {
  assert.equal(isFreshTotpStep(100, 99), true);
  assert.equal(isFreshTotpStep(100, 100), false);
  assert.equal(isFreshTotpStep(99, 100), false);
  assert.equal(isFreshTotpStep(Number.NaN, 0), false);
});

test("platform access requires the platform role but not MFA", () => {
  for (const viewer of [
    null,
    {
      user: { platformAdmin: false, mfaEnabled: true },
      mfaVerified: true,
    },
    {
      user: {
        platformAdmin: false,
        mfaEnabled: false,
        membership: {
          tenantId: "tenant-a",
          username: "company-admin",
          role: "company_admin",
        },
      },
      mfaVerified: false,
    },
    {
      user: {
        platformAdmin: false,
        mfaEnabled: false,
        membership: {
          tenantId: "tenant-a",
          username: "company-user",
          role: "company_user",
        },
      },
      mfaVerified: false,
    },
  ]) {
    assert.throws(
      () => requirePlatformAccess(viewer),
      viewer ? { status: 403 } : { status: 401 },
    );
  }
  assert.doesNotThrow(() =>
    requirePlatformAccess({
      user: { platformAdmin: true, mfaEnabled: false },
      mfaVerified: false,
    }),
  );
});

test("MFA endpoints are unavailable", async () => {
  for (const action of ["mfa-setup", "mfa-enable", "mfa", "recovery"]) {
    const response = await authPost(
      new Request(`http://localhost/api/auth/${action}`, { method: "POST" }),
      { params: Promise.resolve({ action }) },
    );
    assert.equal(response.status, 404);
  }
});

test("a user with an existing membership cannot be transferred to another tenant", () => {
  assert.throws(
    () =>
      assertAssignableToTenant(
        { membership: { tenantId: "tenant-a" } },
        "tenant-b",
      ),
    { status: 409 },
  );
  assert.doesNotThrow(() =>
    assertAssignableToTenant(
      { membership: { tenantId: "tenant-a" } },
      "tenant-a",
    ),
  );
  assert.doesNotThrow(() => assertAssignableToTenant({}, "tenant-b"));
});

