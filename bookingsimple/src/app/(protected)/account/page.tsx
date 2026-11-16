import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";
import Link from "next/link";

export default async function AccountPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { user } = viewer;
  return (
    <AccountShell title="Your account" description={`Signed in as ${user.email}`} wide>
      <div className="account-notice">
        {user.platformAdmin ? "Platform administrator" : user.membership
          ? `${user.membership.role === "company_admin" ? "Company administrator" : "Company user"}`
          : "Awaiting role assignment. Workspace access is not enabled."}
      </div>
      {viewer.tenant && (
        <section className="account-section">
          <h2>Current business</h2>
          <p>{viewer.tenant.businessName}</p>
          <p className="account-links"><Link href="/settings">Open business settings</Link></p>
        </section>
      )}
      {user.application && (
        <section className="account-section">
          <h2>Business application</h2>
          <p>{user.application.businessName}</p>
          <p>Status: <strong>{user.application.status}</strong></p>
        </section>
      )}
      {user.platformAdmin && <p className="account-links"><Link href="/admin">Open platform administration</Link></p>}
      <AccountForm endpoint="/api/auth/logout" label="Sign out" fields={[]} />
    </AccountShell>
  );
}
