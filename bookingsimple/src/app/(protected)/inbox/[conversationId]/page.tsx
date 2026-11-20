import { notFound, redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { StorageError } from "@/server/auth-storage";
import { getConversationDetailsForContext } from "@/server/conversation-service";
import { parseConversationId } from "@/server/conversation-validation";
import { ConversationDetailPanel } from "./conversation-detail-panel";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  let conversationId: string;
  try {
    conversationId = parseConversationId((await params).conversationId);
  } catch {
    notFound();
  }
  let details;
  try {
    details = await getConversationDetailsForContext(
      viewer.tenant,
      conversationId,
      { messagePageSize: 50 },
    );
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) notFound();
    throw error;
  }
  return (
    <AccountShell
      title="Conversation"
      description={`Review messages and resolve the Customer for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <ConversationDetailPanel
        canManageArchivedConversation={
          viewer.tenant.role === "company_admin"
        }
        initialDetails={details}
      />
    </AccountShell>
  );
}
