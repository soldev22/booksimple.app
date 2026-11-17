import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { CustomersPanel } from "./customers-panel";

export default async function CustomersPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  return (
    <AccountShell
      title="Customers"
      description={`Manage customer records for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <CustomersPanel />
    </AccountShell>
  );
}
