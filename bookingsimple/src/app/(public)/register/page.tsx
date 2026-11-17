import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";
import {
  getInvitationRegistrationDetails,
  getSafeError,
} from "@/server/auth-service";

export default async function RegisterPage({
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
      title={invitationDetails ? `Join ${invitationDetails.businessName}` : "Create your account"}
      description={
        invitationDetails
          ? "Create your account with the invited email address. Your workspace access will be activated when you verify your email."
          : "Register and verify your email. Workspace access is granted only after approval and role assignment."
      }
    >
      {invitationError ? (
        <p className="account-error" role="alert">{invitationError}</p>
      ) : (
        <AccountForm
          endpoint="/api/auth/register"
          label={invitationDetails ? "Create account and join" : "Register"}
          rememberEmailForLogin
          fields={[
            { name: "name", label: "Your name", autoComplete: "name", maxLength: 100 },
            {
              name: "email",
              label: "Email address",
              type: "email",
              autoComplete: "username",
              maxLength: 254,
              defaultValue: invitationDetails?.email,
              readOnly: Boolean(invitationDetails),
            },
            { name: "password", label: "Password", type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128, help: "Use a unique password of at least 12 characters." },
            ...(invitation
              ? [{
                  name: "invitationToken",
                  label: "Invitation token",
                  type: "hidden" as const,
                  defaultValue: invitation,
                }]
              : [{
                  name: "businessName",
                  label: "Business name",
                  autoComplete: "organization",
                  required: false,
                  maxLength: 100,
                  help: "Complete this only to apply for a new company. To join an existing company, leave it blank and ask that company's administrator to invite this email address. One account can belong to one company.",
                }]),
          ]}
        />
      )}
      <p className="account-links">
        Already registered?{" "}
        <Link
          href={invitation
            ? { pathname: "/login", query: { invitation } }
            : "/login"}
        >
          Sign in
        </Link>
      </p>
    </AccountShell>
  );
}
