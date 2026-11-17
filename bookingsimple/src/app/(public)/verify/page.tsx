import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; invitation?: string }>;
}) {
  const { token, invitation } = await searchParams;
  return (
    <AccountShell title="Verify your email" description="Confirm your email address before signing in.">
      {token ? (
        <AccountForm
          endpoint="/api/auth/verify"
          label="Verify email"
          fields={[
            { name: "token", label: "Verification token", type: "hidden", defaultValue: token },
            ...(invitation
              ? [{
                  name: "invitationToken",
                  label: "Invitation token",
                  type: "hidden" as const,
                  defaultValue: invitation,
                }]
              : []),
          ]}
        />
      ) : (
        <>
          <p>Open the verification link sent to your email address, or request a new one below.</p>
          <AccountForm
            endpoint="/api/auth/resend-verification"
            label="Resend verification email"
            fields={[
              { name: "email", label: "Email address", type: "email", autoComplete: "email", maxLength: 254 },
            ]}
          />
        </>
      )}
      <p className="account-links"><Link href="/login">Back to sign in</Link></p>
    </AccountShell>
  );
}
