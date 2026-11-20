import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { BusinessSettingsPanel } from "../../settings/business-settings-panel";
import { PlatformUsersPanel } from "./platform-users-panel";

export default async function PlatformUsersPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const canManageCompany =
    viewer.tenant?.role === "company_admin";
  if (!viewer.user.platformAdmin && !canManageCompany) redirect("/account");

  return (
    <AccountShell
      title={viewer.user.platformAdmin ? "Users by company" : "Staff"}
      description={
        viewer.user.platformAdmin
          ? "Manage registered users and companies."
          : `Manage Staff accounts and company roles for ${viewer.tenant?.businessName}.`
      }
      viewer={viewer}
      wide
    >
      {!viewer.user.platformAdmin && canManageCompany && (
        <BusinessSettingsPanel section="invitations" />
      )}
      <PlatformUsersPanel
        currentUserId={viewer.user.id}
        platformAdmin={viewer.user.platformAdmin}
      />
    </AccountShell>
  );
}
