import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { parseConversationId } from "@/server/conversation-validation";
import { parseCustomerId } from "@/server/customer-validation";
import { BookingsPanel } from "./bookings-panel";

function validOptionalId(
  value: string | string[] | undefined,
  parser: (input: unknown) => string,
): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return parser(value);
  } catch {
    return undefined;
  }
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: string | string[];
    conversationId?: string | string[];
  }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  const query = await searchParams;
  const customerId = validOptionalId(query.customerId, parseCustomerId);
  const conversationId = validOptionalId(
    query.conversationId,
    parseConversationId,
  );
  return (
    <AccountShell
      title="Bookings"
      description={`Create and manage Bookings for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <BookingsPanel
        canManageServices={viewer.tenant.role === "company_admin"}
        initialConversationId={conversationId}
        initialCustomerId={customerId}
      />
    </AccountShell>
  );
}
