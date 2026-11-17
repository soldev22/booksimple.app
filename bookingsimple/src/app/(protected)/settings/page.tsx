import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";

export default async function BusinessSettingsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  return (
    <AccountShell
      title="Business settings"
      description={`View and manage ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <section className="account-section">
        <h2>Business profile</h2>
        <p>
          View the company name, timezone and currency on your Account page.
          Company administrators can update those values there.
        </p>
        <p className="account-links">
          <Link href="/account#business-profile">Open business profile</Link>
        </p>
      </section>
      {viewer.tenant.role === "company_admin" && (
        <section className="account-section">
          <h2>Users and invitations</h2>
          <p>
            Invite users, assign company roles, and manage access for this
            company.
          </p>
          <p className="account-links">
            <Link href="/admin/users">Manage company users</Link>
          </p>
        </section>
      )}
      <p className="account-links">
        <Link href="/">Back to workspace</Link>
      </p>
    </AccountShell>
  );
}
