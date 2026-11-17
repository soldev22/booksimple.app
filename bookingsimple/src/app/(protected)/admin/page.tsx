import { redirect } from "next/navigation";
import Link from "next/link";
import { getViewer } from "@/server/auth";
import { AccountShell } from "@/app/components/account-shell";

export default async function AdminPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.user.platformAdmin) redirect("/account");
  return (
    <AccountShell
      title="Platform administration"
      description="Choose an administration area."
      viewer={viewer}
      wide
    >
      <nav aria-label="Platform administration" className="admin-navigation">
        <Link href="/admin/users#users">Users</Link>
        <Link href="/admin/users#companies">Companies</Link>
        <Link href="/admin/users#applications">Company applications</Link>
        {viewer.tenant && <Link href="/settings">Business settings</Link>}
        <Link href="/account">My account</Link>
      </nav>
    </AccountShell>
  );
}
