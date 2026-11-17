import type { BusinessView, UserView } from "@/server/auth-types";

export type PlatformUserGroup = {
  key: string;
  name: string;
  status: string;
  users: UserView[];
};

function normalizeBusinessName(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function findPotentialDuplicateBusinesses(
  businessId: string,
  businessName: string,
  businesses: BusinessView[],
): BusinessView[] {
  const normalizedName = normalizeBusinessName(businessName);
  return businesses.filter(
    (business) =>
      business.id !== businessId &&
      normalizeBusinessName(business.name) === normalizedName,
  );
}

function compareUsers(left: UserView, right: UserView): number {
  const leftName = left.name.trim() || left.email;
  const rightName = right.name.trim() || right.email;
  return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
}

export function groupPlatformUsers(
  users: UserView[],
  businesses: BusinessView[],
): PlatformUserGroup[] {
  const groups = new Map<string, PlatformUserGroup>(
    businesses.map((business) => [
      business.id,
      {
        key: business.id,
        name: business.name,
        status: business.status,
        users: [],
      },
    ]),
  );
  const unassigned: UserView[] = [];

  for (const user of users) {
    if (user.status === "deleted" || user.platformAdmin) continue;
    if (!user.membership) {
      unassigned.push(user);
      continue;
    }
    let group = groups.get(user.membership.tenantId);
    if (!group) {
      group = {
        key: user.membership.tenantId,
        name: "Unknown business",
        status: "unavailable",
        users: [],
      };
      groups.set(group.key, group);
    }
    group.users.push(user);
  }

  const companyGroups = [...groups.values()]
    .filter(
      (group) =>
        group.status === "active" ||
        group.status === "unavailable" ||
        group.users.length > 0,
    )
    .sort((left, right) => {
      if (left.status === "unavailable" && right.status !== "unavailable") return 1;
      if (right.status === "unavailable" && left.status !== "unavailable") return -1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .map((group) => ({ ...group, users: group.users.sort(compareUsers) }));

  if (unassigned.length === 0) return companyGroups;
  return [
    ...companyGroups,
    {
      key: "unassigned",
      name: "Unassigned accounts",
      status: "unassigned",
      users: unassigned.sort(compareUsers),
    },
  ];
}
