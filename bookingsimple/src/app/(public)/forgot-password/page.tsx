import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default function ForgotPasswordPage() {
  return (
    <AccountShell title="Reset your password" description="Request a secure password-reset link by email.">
      <AccountForm
        endpoint="/api/auth/request-reset"
        label="Request reset link"
        fields={[{ name: "email", label: "Email address", type: "email", autoComplete: "email", maxLength: 254 }]}
      />
      <p className="account-links"><Link href="/login">Back to sign in</Link></p>
    </AccountShell>
  );
}
