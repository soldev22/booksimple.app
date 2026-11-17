import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_RETENTION,
  retentionSecondsFor,
} from "../src/server/data-retention.ts";

test("balanced retention maps final and temporary operational records", () => {
  assert.equal(
    retentionSecondsFor("notification", "sent"),
    DATA_RETENTION.notificationSentSeconds,
  );
  assert.equal(
    retentionSecondsFor("notification", "failed"),
    DATA_RETENTION.notificationFailedSeconds,
  );
  assert.equal(
    retentionSecondsFor("business-invitation", "accepted"),
    DATA_RETENTION.invitationFinalSeconds,
  );
  assert.equal(
    retentionSecondsFor("membership-reservation", "released"),
    DATA_RETENTION.releasedMembershipReservationSeconds,
  );
  assert.equal(
    retentionSecondsFor("user", "deleted"),
    DATA_RETENTION.deletedAccountTombstoneSeconds,
  );
  assert.equal(retentionSecondsFor("user", "active"), undefined);
  assert.equal(retentionSecondsFor("business", "active"), undefined);
});
