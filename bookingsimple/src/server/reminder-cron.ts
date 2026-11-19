import "server-only";

import { secureEqual } from "./auth-crypto";

export function isAuthorizedReminderCron(
  authorization: string | null,
  configuredSecret: string | undefined,
): boolean {
  const secret = configuredSecret?.trim();
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  return supplied.length > 0 && secureEqual(supplied, secret);
}
