import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AccountShell
      title="Business invitation"
      description="Sign in or register with the email address that received this invitation, then return here to accept it."
    >
      {token ? (
        <AccountForm
          endpoint="/api/business/invitations/accept"
          label="Accept invitation"
          fields={[
            {
              name: "token",
              label: "Invitation token",
              type: "hidden",
              defaultValue: token,
            },
          ]}
        />
      ) : (
        <p className="account-error">Open the invitation link sent to your email address.</p>
      )}
      <p className="account-links">
        <Link href="/login">Sign in</Link>
        <Link href="/register">Register</Link>
      </p>
    </AccountShell>
  );
}
