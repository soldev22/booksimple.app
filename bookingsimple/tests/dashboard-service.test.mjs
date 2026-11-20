import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardDayRange,
  requiresConversationReply,
} from "../src/server/dashboard-service.ts";

test("dashboard day boundaries follow the business timezone", () => {
  assert.deepEqual(
    dashboardDayRange("2026-07-20T23:30:00.000Z", "Europe/London"),
    {
      startAt: "2026-07-20T23:00:00.000Z",
      endAt: "2026-07-21T23:00:00.000Z",
      localDate: "2026-07-21",
    },
  );
  assert.deepEqual(
    dashboardDayRange("2026-11-01T12:00:00.000Z", "America/New_York"),
    {
      startAt: "2026-11-01T04:00:00.000Z",
      endAt: "2026-11-02T05:00:00.000Z",
      localDate: "2026-11-01",
    },
  );
});

test("only customer-last conversations require attention", () => {
  assert.equal(requiresConversationReply({ lastMessageDirection: "INBOUND" }), true);
  assert.equal(
    requiresConversationReply({ lastMessageDirection: "OUTBOUND" }),
    false,
  );
});
