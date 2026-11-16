import "server-only";

import { randomUUID } from "node:crypto";
import { accountPartition, sha256 } from "../src/server/auth-crypto";
import { type UserDocument } from "../src/server/auth";
import {
  BOOTSTRAP_LOCK_ID,
  BOOTSTRAP_LOCK_PARTITION,
  claimBootstrapLock,
  type BootstrapLockDocument,
} from "../src/server/bootstrap-lock";
import {
  controlContainer,
  readDocument,
  replaceDocument,
  type AuthDocument,
  type Versioned,
} from "../src/server/auth-storage";

type AuditDocument = AuthDocument & {
  type: "platform-admin-audit";
  actorUserId: string;
  action: string;
  affectedUserId: string;
  outcome: "succeeded";
  createdAt: string;
  ttl: 31_536_000;
};

class BootstrapCliError extends Error {}

let phase = "input validation";

function readEmailArgument(): string {
  const index = process.argv.indexOf("--email");
  const email = index >= 0 ? process.argv[index + 1]?.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BootstrapCliError("Provide a verified account with --email user@example.com.");
  }
  return email;
}

async function main() {
  const email = readEmailArgument();
  phase = "bootstrap configuration";
  const setupToken = process.env.PLATFORM_BOOTSTRAP_SETUP_TOKEN;
  if (!setupToken || Buffer.byteLength(setupToken, "utf8") < 32) {
    throw new BootstrapCliError(
      "Set PLATFORM_BOOTSTRAP_SETUP_TOKEN to an operator-managed random value of at least 32 bytes.",
    );
  }
  if (!process.argv.includes("--confirm")) {
    throw new BootstrapCliError(
      "This one-time operation requires the explicit --confirm option.",
    );
  }

  phase = "account eligibility";
  const partitionKey = accountPartition(email);
  const control = controlContainer();
  const userResult = await readDocument<UserDocument>(
    control,
    "user",
    partitionKey,
  );
  if (
    !userResult ||
    userResult.document.email !== email ||
    !userResult.document.emailVerified ||
    userResult.document.status !== "active"
  ) {
    throw new BootstrapCliError(
      "The account must exist, be active, and have a verified email before bootstrap.",
    );
  }
  phase = "one-time bootstrap lock";
  let lock: Versioned<BootstrapLockDocument>;
  try {
    lock = await claimBootstrapLock(
      userResult.document.userId,
      sha256(setupToken),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "The one-time bootstrap has already been claimed."
    ) {
      throw new BootstrapCliError(
        "The one-time bootstrap is already claimed by a different account or setup token.",
      );
    }
    throw error;
  }
  if (lock.document.status === "completed") {
    if (userResult.document.platformAdmin) {
      console.log("The requested account is already the bootstrapped platform administrator.");
      return;
    }
    throw new BootstrapCliError(
      "The one-time bootstrap is complete. Use an existing platform administrator to grant access.",
    );
  }

  if (!userResult.document.platformAdmin) {
    phase = "platform-role grant";
    const audit: AuditDocument = {
      id: `audit_${randomUUID()}`,
      partitionKey,
      type: "platform-admin-audit",
      schemaVersion: 1,
      actorUserId: userResult.document.userId,
      action: "initial-platform-admin-bootstrap",
      affectedUserId: userResult.document.userId,
      outcome: "succeeded",
      createdAt: new Date().toISOString(),
      ttl: 31_536_000,
    };
    const updatedUser: UserDocument = {
      ...userResult.document,
      platformAdmin: true,
      authVersion: userResult.document.authVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    const response = await control.items.batch(
      [
        {
          operationType: "Replace",
          id: updatedUser.id,
          resourceBody: updatedUser,
          ifMatch: userResult.etag,
        },
        { operationType: "Create", resourceBody: audit },
      ],
      partitionKey,
    );
    if (
      (response.code ?? 503) < 200 ||
      (response.code ?? 503) >= 300 ||
      response.result?.some(
        (operation) =>
          operation.statusCode < 200 || operation.statusCode >= 300,
      )
    ) {
      throw new BootstrapCliError(
        "The bootstrap role update conflicted or failed. Retry only with the same verified account and setup token.",
      );
    }
  }

  phase = "bootstrap lock completion";
  const latestLock = await readDocument<BootstrapLockDocument>(
    control,
    BOOTSTRAP_LOCK_ID,
    BOOTSTRAP_LOCK_PARTITION,
  );
  if (!latestLock || latestLock.document.userId !== userResult.document.userId) {
    throw new BootstrapCliError("The bootstrap lock changed unexpectedly.");
  }
  if (latestLock.document.status !== "completed") {
    await replaceDocument(
      control,
      {
        ...latestLock.document,
        status: "completed",
        completedAt: new Date().toISOString(),
      },
      latestLock.etag,
    );
  }
  console.log(
    "Initial platform administrator granted. Existing sessions were invalidated; sign in again.",
  );
}

main().catch((error: unknown) => {
  if (error instanceof BootstrapCliError) {
    console.error(`Platform-admin bootstrap blocked: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const message =
    error instanceof Error && /^Missing required environment variable: [A-Z_]+$/.test(error.message)
      ? error.message
      : "";
  const configurationHint = message
    ? ` Required configuration: ${message.split(": ").at(-1)}.`
    : "";
  console.error(
    `Platform-admin bootstrap failed during ${phase}.${configurationHint} No secrets or account data were printed.`,
  );
  process.exitCode = 1;
});
