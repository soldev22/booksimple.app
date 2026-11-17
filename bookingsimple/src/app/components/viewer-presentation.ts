import type { Viewer } from "@/server/auth-types";

export type ViewerPresentation = {
  displayName: string;
  roles: string[];
  companyName: string;
};

export function getViewerPresentation(viewer: Viewer): ViewerPresentation {
  const roles: string[] = [];
  if (viewer.user.membership) {
    roles.push(
      viewer.user.membership.role === "company_admin"
        ? "Company administrator"
        : "Company user",
    );
  }
  if (viewer.user.platformAdmin) roles.push("Platform administrator");

  return {
    displayName: viewer.user.name.trim() || viewer.user.email,
    roles: roles.length ? roles : ["No assigned role"],
    companyName:
      viewer.tenant?.businessName ??
      (viewer.user.membership ? "Company unavailable" : "No company assigned"),
  };
}
