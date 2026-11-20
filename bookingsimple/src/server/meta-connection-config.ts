import "server-only";

import { z } from "zod";

const pageIdSchema = z.string().regex(/^\d{5,40}$/);
const graphApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const secretSchema = z.string().min(16).max(4_096).regex(/^\S+$/);

const legacyRouteSchema = z
  .object({
    tenantId: z.uuid(),
    pageId: pageIdSchema,
    pageAccessToken: secretSchema,
    appSecret: secretSchema,
    verifyToken: secretSchema,
    graphApiVersion: graphApiVersionSchema,
  })
  .strict();

export type MetaProviderRoute = z.infer<typeof legacyRouteSchema>;

export type MetaOAuthConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  graphApiVersion: string;
  appOrigin: string;
  oauthRedirectUri: string;
};

function configurationError(): Error {
  return new Error("Meta Messenger is not configured.");
}

export function legacyMetaRoutes(): MetaProviderRoute[] {
  const raw = process.env.META_MESSENGER_ROUTES?.trim();
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw configurationError();
  }
  const parsed = z.array(legacyRouteSchema).max(100).safeParse(value);
  if (!parsed.success) throw configurationError();
  const tenants = new Set<string>();
  const pages = new Set<string>();
  for (const route of parsed.data) {
    if (tenants.has(route.tenantId) || pages.has(route.pageId)) {
      throw configurationError();
    }
    tenants.add(route.tenantId);
    pages.add(route.pageId);
  }
  return parsed.data;
}

function sharedLegacyValue(
  field: "appSecret" | "verifyToken" | "graphApiVersion",
): string | undefined {
  const values = [...new Set(legacyMetaRoutes().map((route) => route[field]))];
  if (values.length > 1) throw configurationError();
  return values[0];
}

export function metaAppSecret(): string {
  const value =
    process.env.META_APP_SECRET?.trim() ?? sharedLegacyValue("appSecret");
  if (!value || !secretSchema.safeParse(value).success) {
    throw configurationError();
  }
  return value;
}

export function metaWebhookVerifyToken(): string {
  const value =
    process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ??
    sharedLegacyValue("verifyToken");
  if (!value || !secretSchema.safeParse(value).success) {
    throw configurationError();
  }
  return value;
}

export function metaGraphApiVersion(): string {
  const value =
    process.env.META_GRAPH_API_VERSION?.trim() ??
    sharedLegacyValue("graphApiVersion");
  if (!value || !graphApiVersionSchema.safeParse(value).success) {
    throw configurationError();
  }
  return value;
}

export function parseMetaOAuthConfig(
  environment: NodeJS.ProcessEnv,
): MetaOAuthConfig {
  const appId = environment.META_APP_ID?.trim() ?? "";
  const appSecret = environment.META_APP_SECRET?.trim() ?? "";
  const verifyToken = environment.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";
  const graphApiVersion = environment.META_GRAPH_API_VERSION?.trim() ?? "";
  const appOriginValue = environment.APP_ORIGIN?.trim() ?? "";
  let appOrigin: string;
  try {
    const parsed = new URL(appOriginValue);
    if (
      (parsed.protocol !== "https:" && parsed.hostname !== "localhost") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw configurationError();
    }
    appOrigin = parsed.origin;
  } catch {
    throw configurationError();
  }
  if (
    !/^\d{5,40}$/.test(appId) ||
    !secretSchema.safeParse(appSecret).success ||
    !secretSchema.safeParse(verifyToken).success ||
    !graphApiVersionSchema.safeParse(graphApiVersion).success
  ) {
    throw configurationError();
  }
  const encryptionKey = environment.META_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const decoded = Buffer.from(encryptionKey, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== encryptionKey) {
    throw configurationError();
  }
  return {
    appId,
    appSecret,
    verifyToken,
    graphApiVersion,
    appOrigin,
    oauthRedirectUri: `${appOrigin}/api/meta/connect/oauth/callback`,
  };
}

export function metaOAuthIsConfigured(): boolean {
  try {
    parseMetaOAuthConfig(process.env);
    return true;
  } catch {
    return false;
  }
}
