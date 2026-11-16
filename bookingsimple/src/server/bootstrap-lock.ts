import "server-only";

import {
  controlContainer,
  createDocument,
  readDocument,
  type AuthDocument,
  type Versioned,
} from "./auth-storage";

export const BOOTSTRAP_LOCK_ID = "platform-bootstrap-lock";
export const BOOTSTRAP_LOCK_PARTITION = "bootstrap-global";

export type BootstrapLockDocument = AuthDocument & {
  type: "platform-bootstrap-lock";
  userId: string;
  setupTokenHash: string;
  status: "claimed" | "completed";
  createdAt: string;
  completedAt?: string;
};

export async function claimBootstrapLock(
  userId: string,
  setupTokenHash: string,
  id = BOOTSTRAP_LOCK_ID,
  partitionKey = BOOTSTRAP_LOCK_PARTITION,
): Promise<Versioned<BootstrapLockDocument>> {
  const container = controlContainer();
  const current = await readDocument<BootstrapLockDocument>(
    container,
    id,
    partitionKey,
  );
  if (current) {
    if (
      current.document.userId !== userId ||
      current.document.setupTokenHash !== setupTokenHash
    ) {
      throw new Error("The one-time bootstrap has already been claimed.");
    }
    return current;
  }
  try {
    return await createDocument(container, {
      id,
      partitionKey,
      type: "platform-bootstrap-lock",
      schemaVersion: 1,
      userId,
      setupTokenHash,
      status: "claimed",
      createdAt: new Date().toISOString(),
    });
  } catch {
    const raced = await readDocument<BootstrapLockDocument>(
      container,
      id,
      partitionKey,
    );
    if (
      !raced ||
      raced.document.userId !== userId ||
      raced.document.setupTokenHash !== setupTokenHash
    ) {
      throw new Error("The one-time bootstrap has already been claimed.");
    }
    return raced;
  }
}
