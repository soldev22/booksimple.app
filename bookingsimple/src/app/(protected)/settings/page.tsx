import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { BusinessSettingsPanel } from "./business-settings-panel";

export default async function BusinessSettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  return (
    <AccountShell
      title="Business settings"
      description={`View and manage ${viewer.tenant.businessName}.`}
      wide
    >
      <p className="account-links">
        <Link href="/">Back to workspace</Link>
        <Link href="/account">My account</Link>
      </p>
      <BusinessSettingsPanel />
    </AccountShell>
  );
}
