import "server-only";

import { queryAllPages, controlContainer } from "../src/server/auth-storage";
import { deliverNotification } from "../src/server/auth-notifications";

async function main() {
  const pending = await queryAllPages<{ id: string; partitionKey: string }>(
    controlContainer(),
    "SELECT c.id, c.partitionKey FROM c WHERE c.type = @type AND (c.status = @pending OR c.status = @failed)",
    [
      { name: "@type", value: "notification" },
      { name: "@pending", value: "pending" },
      { name: "@failed", value: "failed" },
    ],
    100,
    10_000,
  );
  let delivered = 0;
  let failed = 0;
  for (const notification of pending) {
    if (await deliverNotification(notification.partitionKey, notification.id)) {
      delivered += 1;
    } else {
      failed += 1;
    }
  }
  console.log(`Notification retry completed: ${delivered} delivered, ${failed} still pending.`);
}

main().catch(() => {
  console.error("Notification retry failed. No message content or secrets were logged.");
  process.exitCode = 1;
});
