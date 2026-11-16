import "server-only";

import {
  controlContainer,
  isPreconditionFailed,
  queryAllPages,
  replaceDocument,
} from "../src/server/auth-storage";
import {
  DEFAULT_BUSINESS_CURRENCY,
  DEFAULT_BUSINESS_TIMEZONE,
  type BusinessDocument,
} from "../src/server/business-types";

async function run(): Promise<void> {
  const businesses = await queryAllPages<BusinessDocument>(
    controlContainer(),
    "SELECT * FROM c WHERE c.type = @type",
    [{ name: "@type", value: "business" }],
    100,
    10_000,
  );
  let updated = 0;
  for (const business of businesses) {
    if (business.timezone && business.currency) {
      continue;
    }
    const current = await controlContainer()
      .item(business.id, business.partitionKey)
      .read<BusinessDocument>();
    if (!current.resource || !current.etag) {
      throw new Error("A business document could not be read for migration.");
    }
    try {
      await replaceDocument(
        controlContainer(),
        {
          ...current.resource,
          timezone: current.resource.timezone ?? DEFAULT_BUSINESS_TIMEZONE,
          currency: current.resource.currency ?? DEFAULT_BUSINESS_CURRENCY,
          updatedAt: new Date().toISOString(),
        },
        current.etag,
      );
      updated += 1;
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new Error(
          "A business changed during migration. Retry the migration.",
        );
      }
      throw error;
    }
  }
  console.log(
    `Business settings migration completed. Scanned ${businesses.length}; updated ${updated}.`,
  );
}

run().catch(() => {
  console.error(
    "Business settings migration failed. No business data or credentials were printed.",
  );
  process.exitCode = 1;
});
