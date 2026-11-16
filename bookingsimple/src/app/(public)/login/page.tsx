import Link from "next/link";
import { AccountShell } from "@/app/components/account-shell";
import { AccountForm } from "@/app/components/account-form";

export default function LoginPage() {
  return (
    <AccountShell title="Sign in" description="Use your email address and password to access your account.">
      <AccountForm
        endpoint="/api/auth/login"
        label="Sign in"
        fields={[
          { name: "email", label: "Email address", type: "email", autoComplete: "username", maxLength: 254 },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password", maxLength: 128 },
        ]}
      />
      <div className="account-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/register">Create an account</Link>
        <Link href="/verify">Resend verification email</Link>
      </div>
    </AccountShell>
  );
}
