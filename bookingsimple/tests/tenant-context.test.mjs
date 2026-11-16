import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTenantAccess,
  requireCompanyAdmin,
  requireTenantContext,
} from "../src/server/tenant-context.ts";

const companyAdmin = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  businessName: "Business A",
  username: "admin",
  role: "company_admin",
};

const companyUser = {
  ...companyAdmin,
  username: "user",
  role: "company_user",
};

test("tenant context requires an authenticated active business membership", () => {
  assert.throws(() => requireTenantContext(null), { status: 401 });
  assert.throws(
    () =>
      requireTenantContext({
        user: {
          platformAdmin: true,
        },
        mfaVerified: false,
      }),
    { status: 403 },
  );
  assert.equal(
    requireTenantContext({
      user: {
        platformAdmin: false,
      },
      tenant: companyUser,
      mfaVerified: false,
    }),
    companyUser,
  );
});

test("company administration requires the tenant administrator role", () => {
  assert.throws(() => requireCompanyAdmin(companyUser), { status: 403 });
  assert.doesNotThrow(() => requireCompanyAdmin(companyAdmin));
});

test("tenant identifiers cannot cross the authenticated business boundary", () => {
  assert.doesNotThrow(() => assertTenantAccess(companyAdmin, companyAdmin.tenantId));
  assert.throws(
    () =>
      assertTenantAccess(
        companyAdmin,
        "22222222-2222-4222-8222-222222222222",
      ),
    { status: 403 },
  );
});
