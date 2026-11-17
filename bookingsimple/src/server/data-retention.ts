const DAY_SECONDS = 24 * 60 * 60;

export const DATA_RETENTION = {
  privilegedAuditSeconds: 365 * DAY_SECONDS,
  notificationPendingSeconds: 30 * DAY_SECONDS,
  notificationFailedSeconds: 30 * DAY_SECONDS,
  notificationSentSeconds: 90 * DAY_SECONDS,
  invitationPendingSeconds: 30 * DAY_SECONDS,
  invitationFinalSeconds: 90 * DAY_SECONDS,
  releasedMembershipReservationSeconds: 30 * DAY_SECONDS,
  deletedAccountTombstoneSeconds: 365 * DAY_SECONDS,
} as const;

export function retentionSecondsFor(
  type: string,
  status?: string,
): number | undefined {
  if (type === "notification") {
    return status === "sent"
      ? DATA_RETENTION.notificationSentSeconds
      : status === "failed"
        ? DATA_RETENTION.notificationFailedSeconds
        : status === "pending"
          ? DATA_RETENTION.notificationPendingSeconds
          : undefined;
  }
  if (type === "business-invitation") {
    return status === "pending"
      ? DATA_RETENTION.invitationPendingSeconds
      : status === "accepted" || status === "revoked"
        ? DATA_RETENTION.invitationFinalSeconds
        : undefined;
  }
  if (type === "membership-reservation" && status === "released") {
    return DATA_RETENTION.releasedMembershipReservationSeconds;
  }
  if (type === "platform-admin-audit" || type === "affected-account-audit") {
    return DATA_RETENTION.privilegedAuditSeconds;
  }
  if (type === "deleted-user-tombstone" || (type === "user" && status === "deleted")) {
    return DATA_RETENTION.deletedAccountTombstoneSeconds;
  }
  return undefined;
}
