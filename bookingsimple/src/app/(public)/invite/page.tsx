import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (token) {
    redirect(`/register?invitation=${encodeURIComponent(token)}`);
  }

  return (
    <AccountShell
      title="Business invitation"
      description="Open the invitation link sent to your email address to join the business."
    >
      <p className="account-error">The invitation link is missing its secure token.</p>
      <p className="account-links">
        <Link href="/login">Sign in</Link>
        <Link href="/register">Register</Link>
      </p>
    </AccountShell>
  );
}
