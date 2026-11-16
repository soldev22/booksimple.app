import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import { AccountShell } from "@/app/components/account-shell";
import { AdminPanel } from "./admin-panel";

export default async function AdminPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.user.platformAdmin) redirect("/account");
  return (
    <AccountShell title="Platform administration" description="Review business applications and manage registered users. All changes are checked and audited on the server." wide>
      <AdminPanel />
    </AccountShell>
  );
}
