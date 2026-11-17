import { notFound, redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { StorageError } from "@/server/auth-storage";
import {
  canPermanentlyEraseCustomers,
  getCustomer,
} from "@/server/customer-service";
import { parseCustomerId } from "@/server/customer-validation";
import { CustomerDetailPanel } from "./customer-detail-panel";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  let customerId: string;
  try {
    customerId = parseCustomerId((await params).customerId);
  } catch {
    notFound();
  }
  let customer;
  try {
    customer = await getCustomer(viewer.tenant, customerId);
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) notFound();
    throw error;
  }
  return (
    <AccountShell
      title="Customer details"
      description={`View and manage this customer for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <CustomerDetailPanel
        canPermanentlyErase={canPermanentlyEraseCustomers(viewer)}
        initialCustomer={customer}
      />
    </AccountShell>
  );
}
