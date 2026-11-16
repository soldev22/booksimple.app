"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AccountForm, type ActionResult } from "@/app/components/account-form";

export function SecurityPanel({
  enabled,
  verified,
  platformAdmin,
}: {
  enabled: boolean;
  verified: boolean;
  platformAdmin: boolean;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<ActionResult | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [enrolled, setEnrolled] = useState(enabled);
  const [authenticated, setAuthenticated] = useState(verified);

  function completed() {
    setAuthenticated(true);
    router.refresh();
  }

  return (
    <section className="account-section" aria-labelledby="security-title">
      <h2 id="security-title">Account security</h2>
      {backupCodes.length > 0 ? (
        <div>
          <p>Save these one-time backup codes somewhere secure. They are shown only once.</p>
          <ul className="backup-codes">{backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <button className="account-button" onClick={() => { setBackupCodes([]); router.refresh(); }}>
            I have saved my backup codes
          </button>
        </div>
      ) : !enrolled ? (
        <div>
          <p>Set up an authenticator app. Platform administrators must use it before accessing administration.</p>
          {!setup ? (
            <AccountForm endpoint="/api/auth/mfa-setup" fields={[]} label="Set up authenticator" onSuccess={(result) => {
              if (!result.secret || !result.uri) {
                throw new Error("The server did not return authenticator setup details.");
              }
              setSetup(result);
            }} />
          ) : (
            <>
              <p>Add a time-based account in your authenticator app using this setup key:</p>
              <p className="setup-secret"><code>{setup.secret}</code></p>
              <AccountForm
                endpoint="/api/auth/mfa-enable"
                fields={[{ name: "code", label: "Six-digit authenticator code", autoComplete: "one-time-code", minLength: 6, maxLength: 6 }]}
                label="Confirm authenticator"
                onSuccess={(result) => {
                  if (!result.backupCodes?.length) {
                    throw new Error("The server did not return recovery codes. Contact support before continuing.");
                  }
                  setSetup(null);
                  setEnrolled(true);
                  setBackupCodes(result.backupCodes);
                  completed();
                }}
              />
            </>
          )}
        </div>
      ) : !authenticated ? (
        <div>
          <p>Complete authenticator verification for this sign-in.</p>
          <AccountForm
            endpoint="/api/auth/mfa"
            fields={[{ name: "code", label: "Authenticator code", autoComplete: "one-time-code", minLength: 6, maxLength: 6 }]}
            label="Verify"
            onSuccess={completed}
          />
          <details className="account-section">
            <summary>Lost access to your authenticator?</summary>
            <AccountForm
              endpoint="/api/auth/recovery"
              fields={[{ name: "code", label: "One-time backup code", autoComplete: "off", maxLength: 100 }]}
              label="Use backup code"
              onSuccess={completed}
            />
          </details>
        </div>
      ) : (
        <p className="account-notice">Authenticator verification completed for this session.</p>
      )}
      {platformAdmin && authenticated && backupCodes.length === 0 && (
        <p className="account-links"><Link href="/admin">Open platform administration</Link></p>
      )}
    </section>
  );
}
