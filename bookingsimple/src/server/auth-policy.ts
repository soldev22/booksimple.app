import type { UserView, Viewer } from "./auth-types";

export class AuthPolicyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthPolicyError";
  }
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

export function requirePlatformAccess(viewer: Viewer | null): asserts viewer is Viewer {
  if (!viewer) {
    throw new AuthPolicyError("Sign in is required.", 401);
  }
  if (!viewer.user.platformAdmin) {
    throw new AuthPolicyError("Platform administrator access is required.", 403);
  }
}

export function assertAssignableToTenant(
  user: Pick<UserView, "membership">,
  tenantId: string,
): void {
  if (user.membership && user.membership.tenantId !== tenantId) {
    throw new AuthPolicyError("A user cannot be assigned to another business.", 409);
  }
}

export function isFreshTotpStep(candidateStep: number, lastAcceptedStep: number): boolean {
  return Number.isSafeInteger(candidateStep) && candidateStep > lastAcceptedStep;
}
