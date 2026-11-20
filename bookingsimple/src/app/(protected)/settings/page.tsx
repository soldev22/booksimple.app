import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { MetaConnectionPanel } from "./meta-connection-panel";

export default async function BusinessSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; state?: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  const query = await searchParams;
  const metaResult = ["select", "cancelled", "error"].includes(
    query.meta ?? "",
  )
    ? (query.meta as "select" | "cancelled" | "error")
    : undefined;
  const selectionState =
    typeof query.state === "string" && query.state.length <= 100
      ? query.state
      : undefined;
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
      <MetaConnectionPanel
        metaResult={metaResult}
        selectionState={selectionState}
      />
    </AccountShell>
  );
}
