import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePhone,
  parseCustomerId,
  parseCustomerMutationInput,
  parseCustomerSearchInput,
  parseEraseCustomerInput,
} from "../src/server/customer-validation.ts";

test("customer input normalizes optional contact details", () => {
  assert.deepEqual(
    parseCustomerMutationInput({
      name: "  Alex Smith  ",
      email: " Alex@Example.com ",
      phone: " +44 (0) 7700-900123 ",
    }),
    {
      name: "Alex Smith",
      email: "alex@example.com",
      phone: "+4407700900123",
    },
  );
  assert.deepEqual(
    parseCustomerMutationInput({ name: "No Contact", email: "", phone: "" }),
    { name: "No Contact", email: undefined, phone: undefined },
  );
  assert.equal(normalizePhone("020 1234 5678"), "02012345678");
});

test("customer input rejects invalid contact details and tenant injection", () => {
  for (const input of [
    { name: "", email: "", phone: "" },
    { name: "Alex", email: "invalid", phone: "" },
    { name: "Alex", email: "", phone: "123" },
    {
      name: "Alex",
      email: "",
      phone: "",
      tenantId: "11111111-1111-4111-8111-111111111111",
    },
  ]) {
    assert.throws(() => parseCustomerMutationInput(input));
  }
});

test("customer list input is bounded and uses explicit statuses", () => {
  assert.deepEqual(
    parseCustomerSearchInput(
      new URLSearchParams({
        search: " Alex ",
        status: "archived",
        pageSize: "25",
        continuationToken: "opaque-token",
      }),
    ),
    {
      search: "Alex",
      status: "archived",
      pageSize: 25,
      continuationToken: "opaque-token",
    },
  );
  assert.throws(() =>
    parseCustomerSearchInput(new URLSearchParams({ status: "deleted" })),
  );
  assert.throws(() =>
    parseCustomerSearchInput(new URLSearchParams({ pageSize: "101" })),
  );
});

test("customer identifiers and permanent erasure confirmation are strict", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseCustomerId(id), id);
  assert.throws(() => parseCustomerId("customer-1"));
  assert.deepEqual(parseEraseCustomerInput({ confirmation: "ERASE" }), {
    confirmation: "ERASE",
  });
  assert.throws(() => parseEraseCustomerInput({ confirmation: "erase" }));
});
