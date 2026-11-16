import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AccountShell title="Choose a new password" description="Resetting your password signs out all existing sessions.">
      {token ? (
        <AccountForm
          endpoint="/api/auth/reset"
          label="Save new password"
          fields={[
            { name: "token", label: "Reset token", type: "hidden", defaultValue: token },
            { name: "password", label: "New password", type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128 },
          ]}
        />
      ) : <p>Open the password-reset link sent to your email address.</p>}
      <p className="account-links"><Link href="/login">Back to sign in</Link></p>
    </AccountShell>
  );
}
