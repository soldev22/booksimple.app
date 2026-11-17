import assert from "node:assert/strict";
import test from "node:test";
import {
  findPotentialDuplicateBusinesses,
  groupPlatformUsers,
} from "../src/app/(protected)/admin/users/platform-user-groups.ts";

const businesses = [
  { id: "business-b", name: "Beta Services", status: "active", memberCount: 0, createdAt: "2026-01-02T00:00:00.000Z" },
  { id: "business-a", name: "Alpha Company", status: "active", memberCount: 1, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "business-r", name: "Rejected Company", status: "rejected", memberCount: 0, createdAt: "2026-01-03T00:00:00.000Z" },
];

const users = [
  {
    id: "user-4",
    email: "unassigned@example.test",
    name: "Unassigned User",
    status: "pending",
    platformAdmin: false,
    emailVerified: false,
    mfaEnabled: false,
  },
  {
    id: "user-2",
    email: "staff@example.test",
    name: "Staff User",
    status: "active",
    platformAdmin: false,
    emailVerified: true,
    mfaEnabled: false,
    membership: {
      tenantId: "business-a",
      username: "internal-staff",
      role: "company_user",
    },
  },
  {
    id: "user-3",
    email: "platform@example.test",
    name: "Platform User",
    status: "active",
    platformAdmin: true,
    emailVerified: true,
    mfaEnabled: false,
  },
  {
    id: "user-1",
    email: "admin@example.test",
    name: "Company Admin",
    status: "active",
    platformAdmin: true,
    emailVerified: true,
    mfaEnabled: false,
    membership: {
      tenantId: "business-a",
      username: "internal-admin",
      role: "company_admin",
    },
  },
  {
    id: "user-5",
    email: "orphan@example.test",
    name: "Orphaned Member",
    status: "active",
    platformAdmin: false,
    emailVerified: true,
    mfaEnabled: false,
    membership: {
      tenantId: "missing-business",
      username: "internal-orphan",
      role: "company_user",
    },
  },
  {
    id: "user-6",
    email: "deleted-user-6@deleted.invalid",
    name: "Deleted user",
    status: "deleted",
    platformAdmin: false,
    emailVerified: false,
    mfaEnabled: false,
  },
];

test("company users are grouped without showing platform administrators or deleted tombstones", () => {
  const groups = groupPlatformUsers(users, businesses);

  assert.deepEqual(
    groups.map((group) => ({
      key: group.key,
      name: group.name,
      status: group.status,
      users: group.users.map((user) => user.email),
    })),
    [
      {
        key: "business-a",
        name: "Alpha Company",
        status: "active",
        users: ["staff@example.test"],
      },
      {
        key: "business-b",
        name: "Beta Services",
        status: "active",
        users: [],
      },
      {
        key: "missing-business",
        name: "Unknown business",
        status: "unavailable",
        users: ["orphan@example.test"],
      },
      {
        key: "unassigned",
        name: "Unassigned accounts",
        status: "unassigned",
        users: ["unassigned@example.test"],
      },
    ],
  );
  assert.equal(groups[0].users[0].membership.role, "company_user");
  assert.equal(groups[0].users[0].platformAdmin, false);
  assert.equal(groups.some((group) => group.key === "business-r"), false);
  assert.equal(
    groups.some((group) =>
      group.users.some(
        (user) => user.status === "deleted" || user.platformAdmin,
      ),
    ),
    false,
  );
});

test("possible duplicate companies exclude the application's own business", () => {
  assert.deepEqual(
    findPotentialDuplicateBusinesses(
      "application-business",
      "  ALPHA   COMPANY ",
      [
        ...businesses,
        {
          id: "application-business",
          name: "Alpha Company",
          status: "pending",
          memberCount: 0,
          createdAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    ).map((business) => business.id),
    ["business-a"],
  );
});

test("an empty unassigned group is omitted", () => {
  const groups = groupPlatformUsers(
    users.filter((user) => user.id !== "user-4"),
    businesses,
  );

  assert.equal(groups.some((group) => group.key === "unassigned"), false);
});
