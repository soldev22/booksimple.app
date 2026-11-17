import "server-only";

import type { OperationInput } from "@azure/cosmos";
import {
  controlContainer,
  queryAllPages,
  readDocument,
  replaceDocument,
  type AuthDocument,
} from "../src/server/auth-storage";
import { retentionSecondsFor } from "../src/server/data-retention";

type RetentionDocument = AuthDocument & {
  status?: string;
  encryptedPayload?: string;
};

const apply = process.argv.includes("--apply");

async function run(): Promise<void> {
  const container = controlContainer();
  const documents = await queryAllPages<RetentionDocument>(
    container,
    `SELECT * FROM c WHERE c.type IN (
      "notification",
      "business-invitation",
      "membership-reservation",
      "platform-admin-audit",
      "affected-account-audit",
      "deleted-user-tombstone",
      "user"
    )`,
    [],
    100,
    10_000,
  );
  let eligible = 0;
  let updated = 0;
  let emailIndexesRemoved = 0;

  for (const document of documents) {
    const ttl = retentionSecondsFor(document.type, document.status);
    if (ttl === undefined) continue;
    eligible += 1;

    const current = await readDocument<RetentionDocument>(
      container,
      document.id,
      document.partitionKey,
    );
    if (!current) continue;

    const updatedDocument: RetentionDocument = {
      ...current.document,
      ttl,
    };
    if (
      updatedDocument.type === "notification" &&
      updatedDocument.status === "sent"
    ) {
      delete updatedDocument.encryptedPayload;
    }

    if (updatedDocument.type === "user" && updatedDocument.status === "deleted") {
      const emailIndex = await readDocument<AuthDocument>(
        container,
        "email-index",
        updatedDocument.partitionKey,
      );
      if (!apply) {
        if (emailIndex) emailIndexesRemoved += 1;
        updated += 1;
        continue;
      }
      const operations: OperationInput[] = [
        {
          operationType: "Replace",
          id: updatedDocument.id,
          resourceBody: updatedDocument,
          ifMatch: current.etag,
        },
        ...(emailIndex
          ? [{
              operationType: "Delete" as const,
              id: emailIndex.document.id,
            }]
          : []),
      ];
      const response = await container.items.batch(
        operations,
        updatedDocument.partitionKey,
      );
      const failed = response.result?.find(
        (operation) =>
          operation.statusCode < 200 || operation.statusCode >= 300,
      );
      if ((response.code ?? 503) >= 300 || failed) {
        throw new Error("A deleted-account retention batch failed.");
      }
      if (emailIndex) emailIndexesRemoved += 1;
      updated += 1;
      continue;
    }

    if (
      current.document.ttl === updatedDocument.ttl &&
      current.document.encryptedPayload === updatedDocument.encryptedPayload
    ) {
      continue;
    }
    if (apply) {
      await replaceDocument(container, updatedDocument, current.etag);
    }
    updated += 1;
  }

  console.log(
    `${apply ? "Applied" : "Dry run"}: scanned ${documents.length}; eligible ${eligible}; ${apply ? "updated" : "would update"} ${updated}; ${apply ? "removed" : "would remove"} ${emailIndexesRemoved} deleted-account email indexes.`,
  );
  if (!apply) {
    console.log("Run again with --apply to persist the reviewed retention policy.");
  }
}

run().catch(() => {
  console.error(
    "Data-retention migration failed. No record contents or credentials were printed.",
  );
  process.exitCode = 1;
});
