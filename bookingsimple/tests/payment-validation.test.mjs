import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCreatePaymentInput,
  parseMockPaymentConfirmationInput,
  parsePaymentId,
  parsePaymentListInput,
} from "../src/server/payment-validation.ts";

const bookingId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";

test("Payment creation accepts deposit or balance without browser amounts", () => {
  assert.deepEqual(parseCreatePaymentInput({ bookingId }), {
    bookingId,
    paymentType: "DEPOSIT",
  });
  assert.deepEqual(parseCreatePaymentInput({
    bookingId,
    paymentType: "BALANCE",
  }), {
    bookingId,
    paymentType: "BALANCE",
  });
  assert.deepEqual(
    parsePaymentListInput(new URLSearchParams({ bookingId })),
    { bookingId },
  );
  assert.throws(() =>
    parseCreatePaymentInput({ bookingId, amountMinor: 1 }),
  );
  assert.throws(() =>
    parseCreatePaymentInput({ bookingId, paymentType: "FULL_PAYMENT" }),
  );
  assert.throws(() => parsePaymentListInput(new URLSearchParams()));
});

test("mock Payment confirmation requires bounded identifiers", () => {
  assert.deepEqual(parseMockPaymentConfirmationInput({ eventId }), {
    eventId,
  });
  assert.throws(() =>
    parseMockPaymentConfirmationInput({
      eventId,
      status: "PAID",
    }),
  );
  assert.equal(parsePaymentId(`deposit-${bookingId}`), `deposit-${bookingId}`);
  assert.equal(parsePaymentId(`balance-${bookingId}`), `balance-${bookingId}`);
  assert.throws(() => parsePaymentId(bookingId));
});
