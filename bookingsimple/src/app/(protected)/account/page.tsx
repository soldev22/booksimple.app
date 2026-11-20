import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import { AccountShell } from "@/app/components/account-shell";
import { BusinessSettingsPanel } from "../settings/business-settings-panel";
import { ApplicationResubmissionForm } from "./application-resubmission-form";

type AccountPageProps = {
  searchParams: Promise<{ stripe?: string | string[] }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const stripeParam = (await searchParams).stripe;
  const stripeResult =
    stripeParam === "connected" ||
    stripeParam === "cancelled" ||
    stripeParam === "error"
      ? stripeParam
      : undefined;
  const { user } = viewer;
  return (
    <AccountShell title="Your account" description="Open the areas available to your account." viewer={viewer} wide>
      {viewer.tenant && (
        <BusinessSettingsPanel
          section="profile"
          stripeResult={stripeResult}
        />
      )}
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
