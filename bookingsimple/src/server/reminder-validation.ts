import { z } from "zod";

const reminderListSchema = z
  .object({
    bookingId: z.uuid(),
  })
  .strict();

export function parseReminderListInput(
  searchParams: URLSearchParams,
): { bookingId: string } {
  return reminderListSchema.parse(
    Object.fromEntries(searchParams.entries()),
  );
}
