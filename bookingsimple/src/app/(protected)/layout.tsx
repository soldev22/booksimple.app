import { redirect } from "next/navigation";
import { HeaderUserActions, PageFooter } from "@/app/components/page-chrome";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { getViewer } from "@/server/auth";
import { RootDocument } from "../components/root-document";

export { metadata } from "../components/root-document";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return (
    <RootDocument>
      <WorkspaceShell
        businessName={viewer.tenant?.businessName}
        canManageCompanyUsers={viewer.tenant?.role === "company_admin"}
        footer={<PageFooter />}
        hasTenant={Boolean(viewer.tenant)}
        platformAdmin={viewer.user.platformAdmin}
        userActions={<HeaderUserActions viewer={viewer} />}
      >
        {children}
      </WorkspaceShell>
    </RootDocument>
  );
}
