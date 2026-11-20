import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingCalendarRange,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from "../src/server/booking-time.ts";
import {
  parseBookingId,
  parseBookingDepositOverrideInput,
  parseBookingListInput,
  parseBookingMutationInput,
  parseBookingStatusInput,
  parseBookingUpdateInput,
} from "../src/server/booking-validation.ts";
import { calculatePercentageAmountMinor } from "../src/server/money.ts";

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

test("Booking calendar ranges respect tenant dates and Monday-based weeks", () => {
  assert.deepEqual(
    bookingCalendarRange("2026-11-20", "day", "Europe/London"),
    {
      startAt: "2026-11-20T00:00:00.000Z",
      endAt: "2026-11-21T00:00:00.000Z",
      localDates: ["2026-11-20"],
    },
  );
  assert.deepEqual(
    bookingCalendarRange("2026-11-20", "week", "Europe/London"),
    {
      startAt: "2026-11-16T00:00:00.000Z",
      endAt: "2026-11-23T00:00:00.000Z",
      localDates: [
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
        "2026-11-19",
        "2026-11-20",
        "2026-11-21",
        "2026-11-22",
      ],
    },
  );
  const march = bookingCalendarRange(
    "2026-03-15",
    "month",
    "Europe/London",
  );
  assert.equal(march.startAt, "2026-03-01T00:00:00.000Z");
  assert.equal(march.endAt, "2026-03-31T23:00:00.000Z");
  assert.equal(march.localDates.length, 31);
  assert.equal(march.localDates[0], "2026-03-01");
  assert.equal(march.localDates.at(-1), "2026-03-31");
});

test("Booking mutations accept only reviewed fields", () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const serviceId = "22222222-2222-4222-8222-222222222222";
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const staffUserId = "44444444-4444-4444-8444-444444444444";
  assert.deepEqual(
    parseBookingMutationInput({
      customerId,
      serviceId,
      conversationId,
      staffUserId,
      startLocal: "2026-12-01T10:00",
    }),
    {
      customerId,
      serviceId,
      conversationId,
      staffUserId,
      startLocal: "2026-12-01T10:00",
    },
  );
  assert.deepEqual(
    parseBookingUpdateInput({
      customerId,
      serviceId,
      staffUserId: null,
      startLocal: "2026-12-01T11:00",
    }),
    {
      customerId,
      serviceId,
      staffUserId: null,
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
      startAtFrom: undefined,
      startAtTo: undefined,
    },
  );
  assert.throws(() =>
    parseBookingListInput(new URLSearchParams({ pageSize: "101" })),
  );
  assert.deepEqual(
    parseBookingListInput(
      new URLSearchParams({
        startAtFrom: "2026-11-01T00:00:00.000Z",
        startAtTo: "2026-12-01T00:00:00.000Z",
      }),
    ),
    {
      status: "all",
      customerId: undefined,
      continuationToken: undefined,
      pageSize: 50,
      startAtFrom: "2026-11-01T00:00:00.000Z",
      startAtTo: "2026-12-01T00:00:00.000Z",
    },
  );
  assert.throws(() =>
    parseBookingListInput(
      new URLSearchParams({
        startAtFrom: "2026-11-01T00:00:00.000Z",
      }),
    ),
  );
  assert.throws(() =>
    parseBookingListInput(
      new URLSearchParams({
        startAtFrom: "2026-12-01T00:00:00.000Z",
        startAtTo: "2026-11-01T00:00:00.000Z",
      }),
    ),
  );
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseBookingId(id), id);
  assert.throws(() => parseBookingId("booking-1"));
});

test("deposit calculation rounds half up without floating-point multiplication", () => {
  for (const [percentage, expected] of [
    [0, 0],
    [1, 26],
    [25, 638],
    [50, 1275],
    [99, 2525],
    [100, 2550],
  ]) {
    assert.equal(calculatePercentageAmountMinor(2550, percentage), expected);
  }
  assert.equal(
    calculatePercentageAmountMinor(Number.MAX_SAFE_INTEGER, 100),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(calculatePercentageAmountMinor(0, 25), 0);
  assert.throws(() => calculatePercentageAmountMinor(100, 101));
  assert.throws(() => calculatePercentageAmountMinor(100.5, 25));
});

test("Booking deposit override accepts only an integer percentage", () => {
  assert.deepEqual(parseBookingDepositOverrideInput({ percentage: "25" }), {
    percentage: 25,
  });
  for (const input of [
    { percentage: -1 },
    { percentage: 101 },
    { percentage: 25.5 },
    { percentage: 25, tenantId: "injected" },
  ]) {
    assert.throws(() => parseBookingDepositOverrideInput(input));
  }
});
