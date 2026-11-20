import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { InboxPanel } from "./inbox-panel";

export default async function InboxPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  return (
    <AccountShell
      title="Inbox"
      description={`Manage local Conversations for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <InboxPanel
        canManageArchivedConversations={
          viewer.tenant.role === "company_admin"
        }
      />
    </AccountShell>
  );
}
