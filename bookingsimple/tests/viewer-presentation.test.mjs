import assert from "node:assert/strict";
import test from "node:test";
import { getViewerPresentation } from "../src/app/components/viewer-presentation.ts";

function viewer({ user = {}, ...overrides } = {}) {
  return {
    user: {
      id: "user-1",
      email: "user@example.test",
      name: "Registered User",
      status: "active",
      platformAdmin: false,
      emailVerified: true,
      mfaEnabled: false,
      ...user,
    },
    mfaVerified: false,
    ...overrides,
  };
}

test("viewer presentation keeps company and platform roles distinct", () => {
  assert.deepEqual(
    getViewerPresentation(viewer({
      user: {
        platformAdmin: true,
        membership: {
          tenantId: "business-1",
          username: "internal-name",
          role: "company_admin",
        },
      },
      tenant: {
        tenantId: "business-1",
        businessName: "Example Company",
        username: "internal-name",
        role: "company_admin",
      },
    })),
    {
      displayName: "Registered User",
      roles: ["Company administrator", "Platform administrator"],
      companyName: "Example Company",
    },
  );
});

test("viewer presentation reports accounts without a company or assigned role", () => {
  assert.deepEqual(getViewerPresentation(viewer({
    user: { name: "" },
  })), {
    displayName: "user@example.test",
    roles: ["No assigned role"],
    companyName: "No company assigned",
  });
});
