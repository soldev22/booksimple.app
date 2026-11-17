import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { ServicesPanel } from "./services-panel";

export default async function ServicesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  return (
    <AccountShell
      title="Services"
      description={`Manage bookable Services for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <ServicesPanel />
    </AccountShell>
  );
}
