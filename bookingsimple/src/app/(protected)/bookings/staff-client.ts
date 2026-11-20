import type { UserView } from "@/server/auth-types";
import { loadData } from "../admin/admin-panel";

export type StaffChoice = {
  id: string;
  name: string;
  username: string;
};

export async function loadStaffChoices(
  signal?: AbortSignal,
): Promise<StaffChoice[]> {
  const users = new Map<string, UserView>();
  const seenCursors = new Set<string>();
  let usersCursor: string | undefined;

  do {
    const query = usersCursor
      ? `?${new URLSearchParams({ usersCursor })}`
      : "";
    const page = await loadData(query, signal);
    page.users.forEach((user) => users.set(user.id, user));
    usersCursor = page.usersCursor;
    if (usersCursor) {
      if (seenCursors.has(usersCursor)) {
        throw new Error("The Staff directory returned a repeated page.");
      }
      seenCursors.add(usersCursor);
    }
  } while (usersCursor);

  return [...users.values()]
    .filter(
      (user) =>
        user.status === "active" &&
        !user.platformAdmin &&
        Boolean(user.membership),
    )
    .map((user) => ({
      id: user.id,
      name: user.name,
      username: user.membership!.username,
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}
