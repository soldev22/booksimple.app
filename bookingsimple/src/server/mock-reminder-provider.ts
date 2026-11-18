import "server-only";

export async function deliverMockReminder(
  reminderId: string,
): Promise<{ providerReference: string }> {
  return {
    providerReference: `mock_reminder_${reminderId}`,
  };
}
