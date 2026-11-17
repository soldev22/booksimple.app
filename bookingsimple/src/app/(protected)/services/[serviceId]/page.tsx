import { notFound, redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { StorageError } from "@/server/auth-storage";
import { getService } from "@/server/service-service";
import { parseServiceId } from "@/server/service-validation";
import { ServiceDetailPanel } from "./service-detail-panel";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  let serviceId: string;
  try {
    serviceId = parseServiceId((await params).serviceId);
  } catch {
    notFound();
  }
  let service;
  try {
    service = await getService(viewer.tenant, serviceId);
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) notFound();
    throw error;
  }
  return (
    <AccountShell
      title="Service details"
      description={`View and manage this Service for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <ServiceDetailPanel initialService={service} />
    </AccountShell>
  );
}
