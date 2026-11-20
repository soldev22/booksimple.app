import { z } from "zod";
import type { MetaOAuthConfig } from "./meta-connection-config";

export const META_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const authorizationCodeSchema = z.string().min(8).max(2_048);

export type MetaOAuthCallback =
  | { outcome: "AUTHORIZED"; state: string; code: string }
  | { outcome: "DENIED"; state: string };

export function buildMetaOAuthAuthorizeUrl(
  config: MetaOAuthConfig,
  state: string,
): string {
  if (!META_OAUTH_STATE_PATTERN.test(state)) {
    throw new Error("Meta OAuth state is invalid.");
  }
  const url = new URL(
    `https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`,
  );
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.oauthRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_messaging",
      "business_management",
    ].join(","),
  );
  return url.toString();
}

export function parseMetaOAuthCallback(url: URL): MetaOAuthCallback {
  const state = url.searchParams.get("state") ?? "";
  if (!META_OAUTH_STATE_PATTERN.test(state)) {
    throw new Error("Meta OAuth state is invalid.");
  }
  const error = url.searchParams.get("error");
  if (error) {
    if (error !== "access_denied") {
      throw new Error("Meta OAuth returned an invalid response.");
    }
    return { outcome: "DENIED", state };
  }
  const code = authorizationCodeSchema.safeParse(
    url.searchParams.get("code") ?? "",
  );
  if (!code.success) {
    throw new Error("Meta OAuth returned an invalid response.");
  }
  return { outcome: "AUTHORIZED", state, code: code.data };
}
