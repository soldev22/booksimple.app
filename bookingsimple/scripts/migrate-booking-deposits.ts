import "server-only";

import {
  isPreconditionFailed,
  queryAllPages,
} from "../src/server/auth-storage";
import { bookingContainer } from "../src/server/booking-storage";
import {
  BOOKING_SCHEMA_VERSION,
  type BookingDocument,
} from "../src/server/booking-types";

type LegacyBookingDocument = Omit<
  BookingDocument,
  | "schemaVersion"
  | "defaultDepositPercentage"
  | "appliedDepositPercentage"
  | "depositAmountMinor"
  | "depositOverridden"
> & {
  schemaVersion: 1;
};

const apply = process.argv.includes("--apply");

async function run(): Promise<void> {
  const container = bookingContainer();
  const legacy = await queryAllPages<LegacyBookingDocument>(
    container,
    "SELECT * FROM c WHERE c.type = @type AND c.schemaVersion = @schemaVersion",
    [
      { name: "@type", value: "booking" },
      { name: "@schemaVersion", value: 1 },
    ],
    100,
    10_000,
  );
  let updated = 0;
  for (const document of legacy) {
    const current = await container
      .item(document.id, document.tenantId)
      .read<LegacyBookingDocument>();
    if (!current.resource || !current.etag) continue;
    if (apply) {
      try {
        await container.item(document.id, document.tenantId).replace(
          {
            ...current.resource,
            schemaVersion: BOOKING_SCHEMA_VERSION,
            defaultDepositPercentage: 0,
            appliedDepositPercentage: 0,
            depositAmountMinor: 0,
            depositOverridden: false,
            updatedAt: new Date().toISOString(),
          },
          {
            accessCondition: {
              type: "IfMatch",
              condition: current.etag,
            },
          },
        );
      } catch (error) {
        if (isPreconditionFailed(error)) {
          throw new Error(
            "A Booking changed during migration. Retry the migration.",
          );
        }
        throw error;
      }
    }
    updated += 1;
  }
  console.log(
    `${apply ? "Applied" : "Dry run"}: scanned ${legacy.length} legacy Bookings; ${apply ? "updated" : "would update"} ${updated} to explicit 0% deposit terms.`,
  );
  if (!apply) {
    console.log("Run again with --apply to persist the reviewed migration.");
  }
}

run().catch(() => {
  console.error(
    "Booking-deposit migration failed. No record contents or credentials were printed.",
  );
  process.exitCode = 1;
});
