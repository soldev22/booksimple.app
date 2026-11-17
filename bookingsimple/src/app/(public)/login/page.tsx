import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";
import {
  getInvitationRegistrationDetails,
  getSafeError,
} from "@/server/auth-service";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const { invitation } = await searchParams;
  let invitationDetails: Awaited<
    ReturnType<typeof getInvitationRegistrationDetails>
  > | undefined;
  let invitationError: string | undefined;
  if (invitation) {
    try {
      invitationDetails = await getInvitationRegistrationDetails(invitation);
    } catch (error) {
      const safe = getSafeError(error);
      if (safe.status >= 500) throw error;
      invitationError = safe.message;
    }
  }

  return (
    <AccountShell
      title={invitationDetails ? `Join ${invitationDetails.businessName}` : "Sign in"}
      description={
        invitationDetails
          ? "Sign in with the invited account and your workspace access will be activated automatically."
          : "Use your email address and password to access your account."
      }
    >
      {invitationError ? (
        <p className="account-error" role="alert">{invitationError}</p>
      ) : (
        <AccountForm
          endpoint="/api/auth/login"
          label={invitationDetails ? "Sign in and join" : "Sign in"}
          restoreEmailForLogin
          fields={[
            {
              name: "email",
              label: "Email address",
              type: "email",
              autoComplete: "username",
              maxLength: 254,
              defaultValue: invitationDetails?.email,
              readOnly: Boolean(invitationDetails),
            },
            { name: "password", label: "Password", type: "password", autoComplete: "current-password", maxLength: 128 },
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
      )}
      <div className="account-links login-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link
          href={invitation
            ? { pathname: "/register", query: { invitation } }
            : "/register"}
        >
          Create an account
        </Link>
        <Link href="/verify">Resend verification email</Link>
      </div>
    </AccountShell>
  );
}
