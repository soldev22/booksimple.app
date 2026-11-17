import assert from "node:assert/strict";
import test from "node:test";
import {
  localDateTimeToUtc,
  utcToLocalDateTime,
} from "../src/server/booking-time.ts";
import {
  parseBookingId,
  parseBookingListInput,
  parseBookingMutationInput,
  parseBookingStatusInput,
  parseBookingUpdateInput,
} from "../src/server/booking-validation.ts";

test("Booking times convert between tenant local time and UTC", () => {
  assert.equal(
    localDateTimeToUtc("2026-01-20T10:30", "Europe/London"),
    "2026-01-20T10:30:00.000Z",
  );
  assert.equal(
    localDateTimeToUtc("2026-07-20T10:30", "Europe/London"),
    "2026-07-20T09:30:00.000Z",
  );
  assert.equal(
    utcToLocalDateTime("2026-07-20T09:30:00.000Z", "Europe/London"),
    "2026-07-20T10:30",
  );
});

test("Booking times reject missing and ambiguous clock-change times", () => {
  assert.throws(
    () => localDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => localDateTimeToUtc("2026-11-01T01:30", "America/New_York"),
    /ambiguous/,
  );
  assert.throws(
    () => localDateTimeToUtc("2026-02-30T10:00", "Europe/London"),
    /valid calendar date/,
  );
});

test("Booking mutations accept only reviewed fields", () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const serviceId = "22222222-2222-4222-8222-222222222222";
  const conversationId = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(
    parseBookingMutationInput({
      customerId,
      serviceId,
      conversationId,
      startLocal: "2026-12-01T10:00",
    }),
    {
      customerId,
      serviceId,
      conversationId,
      startLocal: "2026-12-01T10:00",
    },
  );
  assert.deepEqual(
    parseBookingUpdateInput({
      customerId,
      serviceId,
      startLocal: "2026-12-01T11:00",
    }),
    {
      customerId,
      serviceId,
      startLocal: "2026-12-01T11:00",
    },
  );
  assert.throws(() =>
    parseBookingMutationInput({
      customerId,
      serviceId,
      startLocal: "2026-12-01T10:00",
      tenantId: customerId,
    }),
  );
  assert.throws(() =>
    parseBookingMutationInput({
      customerId,
      serviceId,
      startLocal: "2026-12-01T10:00",
      totalAmountMinor: 1,
    }),
  );
});

test("Booking status, list and ID validation is bounded", () => {
  assert.deepEqual(parseBookingStatusInput({ status: "CONFIRMED" }), {
    status: "CONFIRMED",
  });
  assert.throws(() => parseBookingStatusInput({ status: "DELETED" }));
  assert.deepEqual(
    parseBookingListInput(
      new URLSearchParams({
        status: "PENDING",
        customerId: "11111111-1111-4111-8111-111111111111",
        pageSize: "25",
      }),
    ),
    {
      status: "PENDING",
      customerId: "11111111-1111-4111-8111-111111111111",
      continuationToken: undefined,
      pageSize: 25,
    },
  );
  assert.throws(() =>
    parseBookingListInput(new URLSearchParams({ pageSize: "101" })),
  );
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseBookingId(id), id);
  assert.throws(() => parseBookingId("booking-1"));
});
