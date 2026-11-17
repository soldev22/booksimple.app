import Link from "next/link";
import type { Viewer } from "@/server/auth-types";
import { HeaderLogoutButton } from "./header-logout-button";
import { getViewerPresentation } from "./viewer-presentation";

export function SignedInSummary({ viewer }: { viewer: Viewer }) {
  const presentation = getViewerPresentation(viewer);

  return (
    <Link
      aria-label={`Signed in as ${presentation.displayName}. Open account.`}
      className="signed-in-summary"
      href="/account"
    >
      <span aria-hidden="true" className="signed-in-avatar">
        {presentation.displayName.charAt(0).toUpperCase()}
      </span>
      <span className="signed-in-details">
        <strong>{presentation.displayName}</strong>
        <span aria-hidden="true" className="signed-in-divider">·</span>
        <span>{presentation.roles.join(" · ")}</span>
        <span aria-hidden="true" className="signed-in-divider">·</span>
        <span>{presentation.companyName}</span>
      </span>
    </Link>
  );
}

export function HeaderUserActions({ viewer }: { viewer: Viewer }) {
  return (
    <div className="header-user-actions">
      <SignedInSummary viewer={viewer} />
      <HeaderLogoutButton />
    </div>
  );
}

export function PageFooter() {
  return (
    <footer className="shared-page-footer">
      <span>BookSimple</span>
      <span>Built for the way your business works.</span>
    </footer>
  );
}
