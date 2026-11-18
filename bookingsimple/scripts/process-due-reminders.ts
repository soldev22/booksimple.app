import "server-only";

import { processDueReminders } from "../src/server/reminder-service";

async function run(): Promise<void> {
  let totalClaimed = 0;
  let totalSent = 0;
  let totalCancelled = 0;
  let totalFailed = 0;

  for (let batch = 0; batch < 100; batch += 1) {
    const result = await processDueReminders({ limit: 100 });
    totalClaimed += result.claimed;
    totalSent += result.sent;
    totalCancelled += result.cancelled;
    totalFailed += result.failed;
    if (result.claimed < 100) break;
  }

  console.log(
    JSON.stringify({
      event: "reminder-processing-complete",
      claimed: totalClaimed,
      sent: totalSent,
      cancelled: totalCancelled,
      failed: totalFailed,
    }),
  );
  if (totalFailed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error({
    event: "reminder-processing-failed",
    error: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
