import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default function RegisterPage() {
  return (
    <AccountShell
      title="Create your account"
      description="Register and verify your email. Workspace access is granted only after approval and role assignment."
    >
      <AccountForm
        endpoint="/api/auth/register"
        label="Register"
        fields={[
          { name: "name", label: "Your name", autoComplete: "name", maxLength: 100 },
          { name: "email", label: "Email address", type: "email", autoComplete: "email", maxLength: 254 },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128, help: "Use a unique password of at least 12 characters." },
          { name: "businessName", label: "Business name", autoComplete: "organization", required: false, maxLength: 100, help: "Complete this to apply for a new business workspace. Leave blank if you will be assigned to an existing business." },
        ]}
      />
      <p className="account-links">Already registered? <Link href="/login">Sign in</Link></p>
    </AccountShell>
  );
}
