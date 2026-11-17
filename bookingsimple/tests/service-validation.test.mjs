import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMinorAmount,
  minorAmountToInput,
  parsePriceToMinor,
} from "../src/server/money.ts";
import {
  parseServiceId,
  parseServiceMutationInput,
  parseServiceSearchInput,
  parseServiceStatusInput,
} from "../src/server/service-validation.ts";

test("Service prices use exact currency minor units", () => {
  assert.equal(parsePriceToMinor("25.50", "GBP"), 2550);
  assert.equal(parsePriceToMinor("25", "JPY"), 25);
  assert.equal(parsePriceToMinor("25.500", "KWD"), 25500);
  assert.equal(parsePriceToMinor("0", "GBP"), 0);
  assert.equal(minorAmountToInput(2550, "GBP"), "25.50");
  assert.equal(minorAmountToInput(25, "JPY"), "25");
  assert.match(formatMinorAmount(2550, "GBP"), /25\.50/);
  assert.throws(() => parsePriceToMinor("25.001", "GBP"));
  assert.throws(() => parsePriceToMinor("-1", "GBP"));
  assert.throws(() => parsePriceToMinor("1e3", "GBP"));
  assert.throws(() => parsePriceToMinor("90071992547409.92", "GBP"));
});

test("Service input normalizes fields and rejects tenant injection", () => {
  assert.deepEqual(
    parseServiceMutationInput({
      name: " Initial consultation ",
      description: " Introductory appointment. ",
      durationMinutes: "60",
      price: "25.50",
      currency: "gbp",
    }),
    {
      name: "Initial consultation",
      description: "Introductory appointment.",
      durationMinutes: 60,
      priceMinor: 2550,
      currency: "GBP",
    },
  );
  assert.throws(() =>
    parseServiceMutationInput({
      name: "Injected",
      description: "",
      durationMinutes: "30",
      price: "0",
      currency: "GBP",
      tenantId: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assert.deepEqual(
    parseServiceMutationInput({
      name: "No description",
      durationMinutes: "30",
      price: "0",
      currency: "GBP",
    }),
    {
      name: "No description",
      durationMinutes: 30,
      priceMinor: 0,
      currency: "GBP",
    },
  );
});

test("Service input rejects invalid duration, price and currency", () => {
  for (const input of [
    {
      name: "Invalid",
      description: "",
      durationMinutes: "0",
      price: "10",
      currency: "GBP",
    },
    {
      name: "Invalid",
      description: "",
      durationMinutes: "30.5",
      price: "10",
      currency: "GBP",
    },
    {
      name: "Invalid",
      description: "",
      durationMinutes: "30",
      price: "-1",
      currency: "GBP",
    },
    {
      name: "Invalid",
      description: "",
      durationMinutes: "30",
      price: "10",
      currency: "INVALID",
    },
  ]) {
    assert.throws(() => parseServiceMutationInput(input));
  }
});

test("Service list, status and identifiers are strictly validated", () => {
  assert.deepEqual(
    parseServiceSearchInput(
      new URLSearchParams({
        search: " consult ",
        status: "inactive",
        pageSize: "25",
      }),
    ),
    {
      search: "consult",
      status: "inactive",
      pageSize: 25,
      continuationToken: undefined,
    },
  );
  assert.deepEqual(parseServiceStatusInput({ active: false }), {
    active: false,
  });
  assert.throws(() => parseServiceStatusInput({ active: "false" }));
  assert.throws(() =>
    parseServiceSearchInput(new URLSearchParams({ status: "archived" })),
  );
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseServiceId(id), id);
  assert.throws(() => parseServiceId("service-1"));
});
