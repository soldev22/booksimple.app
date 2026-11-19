import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingConfirmationId,
  bookingConfirmationMessage,
  bookingConfirmationMessageId,
} from "../src/server/booking-confirmation-service.ts";

const bookingId = "11111111-1111-4111-8111-111111111111";

test("Booking confirmation identifiers are deterministic and provider-safe", () => {
  assert.equal(
    bookingConfirmationId(bookingId),
    `booking-confirmation-${bookingId}`,
  );
  const messageId = bookingConfirmationMessageId(bookingId);
  assert.equal(messageId, bookingConfirmationMessageId(bookingId));
  assert.match(
    messageId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(
    messageId,
    bookingConfirmationMessageId("22222222-2222-4222-8222-222222222222"),
  );
});

test("Booking confirmation content contains the tenant booking facts", () => {
  const body = bookingConfirmationMessage(
    {
      tenantId: "33333333-3333-4333-8333-333333333333",
      businessName: "Example Business",
      username: "member@example.test",
      role: "company_user",
    },
    {
      id: bookingId,
      customerId: "44444444-4444-4444-8444-444444444444",
      customerName: "Alex Customer",
      customerStatus: "active",
      serviceId: "55555555-5555-4555-8555-555555555555",
      serviceName: "Consultation",
      serviceActive: true,
      startAt: "2026-11-20T10:30:00.000Z",
      endAt: "2026-11-20T11:15:00.000Z",
      timeZone: "Europe/London",
      durationMinutes: 45,
      status: "CONFIRMED",
      totalAmountMinor: 6500,
      currency: "GBP",
      defaultDepositPercentage: 0,
      appliedDepositPercentage: 0,
      depositAmountMinor: 0,
      depositOverridden: false,
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:01:00.000Z",
    },
  );

  assert.match(body, /Hello Alex Customer,/);
  assert.match(body, /Your booking with Example Business is confirmed\./);
  assert.match(body, /Service: Consultation/);
  assert.match(body, /Friday, 20 November 2026 at 10:30/);
  assert.match(body, /Duration: 45 minutes/);
  assert.match(body, new RegExp(`Booking reference: ${bookingId}`));
});
