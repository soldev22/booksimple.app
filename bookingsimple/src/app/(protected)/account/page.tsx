import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import { AccountShell } from "@/app/components/account-shell";
import Link from "next/link";
import { BusinessSettingsPanel } from "../settings/business-settings-panel";
import { ApplicationResubmissionForm } from "./application-resubmission-form";

export default async function AccountPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { user } = viewer;
  return (
    <AccountShell title="Your account" description="Open the areas available to your account." viewer={viewer} wide>
      <nav aria-label="Account destinations" className="admin-navigation">
        {viewer.tenant && <Link href="/settings">Open business settings</Link>}
        {user.platformAdmin && <Link href="/admin">Open platform administration</Link>}
      </nav>
      {viewer.tenant && <BusinessSettingsPanel section="profile" />}
      {user.application && user.application.status !== "approved" && (
        <section className="account-section">
          <h2>Business application</h2>
          <p>{user.application.businessName}</p>
          <p>Status: <strong>{user.application.status}</strong></p>
          {user.application.status === "pending" ? (
            <p>Your application is waiting for platform review.</p>
          ) : (
            <ApplicationResubmissionForm
              businessName={user.application.businessName}
            />
          )}
        </section>
      )}
      {!viewer.tenant && !user.application && (
        <section className="account-section">
          <h2>No company assigned</h2>
          <p>
            Ask a company administrator to invite this email address. Open the
            invitation link and sign in to join their company.
          </p>
        </section>
      )}
    </AccountShell>
  );
}
