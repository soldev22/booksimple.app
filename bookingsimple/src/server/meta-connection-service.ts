import "server-only";

import { z } from "zod";
import { getRequestViewer } from "./auth";
import {
  decryptJson,
  encryptJson,
  randomToken,
  sha256,
} from "./auth-crypto";
import {
  controlContainer,
  createDocument,
  deleteDocument,
  isPreconditionFailed,
  readDocument,
  replaceDocument,
  StorageError,
  type AuthDocument,
  type Versioned,
} from "./auth-storage";
import type { TenantContext } from "./auth-types";
import {
  legacyMetaRoutes,
  metaAppSecret,
  metaGraphApiVersion,
  metaOAuthIsConfigured,
  metaWebhookVerifyToken,
  parseMetaOAuthConfig,
  type MetaProviderRoute,
} from "./meta-connection-config";
import type {
  MetaConnectionView,
  MetaManagedPageSelectionView,
  MetaOAuthCompletion,
  MetaOAuthStartView,
} from "./meta-connection-types";
import {
  buildMetaOAuthAuthorizeUrl,
  META_OAUTH_STATE_PATTERN,
  parseMetaOAuthCallback,
} from "./meta-oauth";
import {
  requireCompanyAdmin,
  requireTenantContext,
} from "./tenant-context";

const META_CONNECTION_ID = "meta-messenger-connection";
const META_TOKEN_KEY = "META_TOKEN_ENCRYPTION_KEY";
const OAUTH_STATE_SECONDS = 10 * 60;
const CONSUMED_STATE_SECONDS = 24 * 60 * 60;
const META_TIMEOUT_MS = 10_000;

const pageIdSchema = z.string().regex(/^\d{5,40}$/);
const pageNameSchema = z.string().trim().min(1).max(120);
const accessTokenSchema = z.string().min(16).max(4_096).regex(/^\S+$/);

type MetaConnectionDocument = AuthDocument & {
  type: "meta-messenger-connection";
  tenantId: string;
  pageId: string;
  pageName: string;
  encryptedPageAccessToken: string;
  graphApiVersion: string;
  connectedByUserId: string;
  connectedAt: string;
  updatedAt: string;
};

type MetaManagedPageCandidate = {
  id: string;
  name: string;
  accessToken: string;
};

type MetaOAuthStateDocument = AuthDocument & {
  type: "meta-oauth-state";
  tenantId: string;
  requestedByUserId: string;
  status:
    | "PENDING"
    | "PROCESSING"
    | "AWAITING_SELECTION"
    | "COMPLETED"
    | "CANCELLED"
    | "FAILED";
  encryptedCandidates?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

const shortTokenResponseSchema = z.object({
  access_token: accessTokenSchema,
  token_type: z.string().optional(),
});

const managedPagesResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: pageIdSchema,
        name: pageNameSchema,
        access_token: accessTokenSchema,
        tasks: z.array(z.string()).max(100).optional(),
      }),
    )
    .max(100),
});

const successResponseSchema = z.object({ success: z.literal(true) });

function metaError(status: number, message: string): StorageError {
  return new StorageError(message, status);
}

function parseGraphResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw metaError(502, message);
  return parsed.data;
}

function stateId(state: string): string {
  return `meta-oauth-state-${sha256(state)}`;
}

function assertConnectionDocument(
  document: MetaConnectionDocument,
  tenantId?: string,
): void {
  if (
    document.type !== "meta-messenger-connection" ||
    document.id !== META_CONNECTION_ID ||
    document.partitionKey !== document.tenantId ||
    (tenantId && document.tenantId !== tenantId) ||
    !pageIdSchema.safeParse(document.pageId).success ||
    !pageNameSchema.safeParse(document.pageName).success ||
    !document.encryptedPageAccessToken
  ) {
    throw metaError(503, "Meta connection data is invalid.");
  }
}

async function readConnection(
  tenantId: string,
): Promise<Versioned<MetaConnectionDocument> | null> {
  const stored = await readDocument<MetaConnectionDocument>(
    controlContainer(),
    META_CONNECTION_ID,
    tenantId,
  );
  if (stored) assertConnectionDocument(stored.document, tenantId);
  return stored;
}

async function connectionsForPage(
  pageId: string,
): Promise<MetaConnectionDocument[]> {
  const response = await controlContainer().items
    .query<MetaConnectionDocument>({
      query: `SELECT TOP 2 * FROM c
        WHERE c.type = @type
          AND c.pageId = @pageId`,
      parameters: [
        { name: "@type", value: "meta-messenger-connection" },
        { name: "@pageId", value: pageId },
      ],
    })
    .fetchNext();
  const connections = response.resources ?? [];
  for (const connection of connections) assertConnectionDocument(connection);
  return connections;
}

function decryptPageToken(document: MetaConnectionDocument): string {
  const token = decryptJson<unknown>(
    document.encryptedPageAccessToken,
    META_TOKEN_KEY,
  );
  const parsed = accessTokenSchema.safeParse(token);
  if (!parsed.success) throw metaError(503, "Meta connection data is invalid.");
  return parsed.data;
}

function routeFromConnection(
  document: MetaConnectionDocument,
): MetaProviderRoute {
  return {
    tenantId: document.tenantId,
    pageId: document.pageId,
    pageAccessToken: decryptPageToken(document),
    appSecret: metaAppSecret(),
    verifyToken: metaWebhookVerifyToken(),
    graphApiVersion: document.graphApiVersion,
  };
}

export async function metaRouteForTenant(
  tenantId: string,
): Promise<MetaProviderRoute> {
  const legacy = legacyMetaRoutes().find((route) => route.tenantId === tenantId);
  if (!metaOAuthIsConfigured()) {
    if (legacy) return legacy;
    throw metaError(503, "Meta Messenger is not configured.");
  }
  const stored = await readConnection(tenantId);
  if (stored) return routeFromConnection(stored.document);
  if (!legacy) throw metaError(503, "Meta Messenger is not configured.");
  return legacy;
}

export async function metaRoutesForPageIds(
  pageIds: string[],
): Promise<MetaProviderRoute[]> {
  const legacy = legacyMetaRoutes();
  if (!metaOAuthIsConfigured()) {
    return pageIds.map((pageId) => {
      const route = legacy.find((candidate) => candidate.pageId === pageId);
      if (!route) {
        throw metaError(401, "Meta Messenger webhook authentication failed.");
      }
      return route;
    });
  }
  return Promise.all(
    pageIds.map(async (pageId) => {
      const stored = await connectionsForPage(pageId);
      if (stored.length > 1) {
        throw metaError(503, "Meta Messenger routing is ambiguous.");
      }
      if (stored[0]) return routeFromConnection(stored[0]);
      const route = legacy.find((candidate) => candidate.pageId === pageId);
      if (!route) {
        throw metaError(401, "Meta Messenger webhook authentication failed.");
      }
      return route;
    }),
  );
}

function connectionView(
  context: TenantContext,
  stored: MetaConnectionDocument | null,
): MetaConnectionView {
  const canManage = context.role === "company_admin";
  if (stored) {
    return {
      status: "CONNECTED",
      canManage,
      pageId: stored.pageId,
      pageName: stored.pageName,
    };
  }
  const legacy = legacyMetaRoutes().find(
    (route) => route.tenantId === context.tenantId,
  );
  if (legacy) {
    return {
      status: "ENVIRONMENT",
      canManage,
      pageId: legacy.pageId,
      pageName: "Deployment-configured Facebook Page",
      details:
        "Connect this Page in BookSimple to replace the deployment-managed route.",
    };
  }
  if (!metaOAuthIsConfigured()) {
    return {
      status: "NOT_CONFIGURED",
      canManage,
      details: "Meta OAuth environment variables are not configured.",
    };
  }
  return { status: "NOT_CONNECTED", canManage };
}

export async function getMetaConnection(
  request: Request,
): Promise<MetaConnectionView> {
  const context = requireTenantContext(await getRequestViewer(request));
  return connectionView(context, (await readConnection(context.tenantId))?.document ?? null);
}

async function createOAuthState(
  tenantId: string,
  userId: string,
): Promise<string> {
  const state = randomToken();
  const id = stateId(state);
  const now = new Date();
  await createDocument<MetaOAuthStateDocument>(controlContainer(), {
    id,
    partitionKey: id,
    type: "meta-oauth-state",
    schemaVersion: 1,
    tenantId,
    requestedByUserId: userId,
    status: "PENDING",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OAUTH_STATE_SECONDS * 1_000).toISOString(),
    ttl: OAUTH_STATE_SECONDS,
  });
  return state;
}

async function requiredOAuthState(
  state: string,
): Promise<Versioned<MetaOAuthStateDocument>> {
  if (!META_OAUTH_STATE_PATTERN.test(state)) {
    throw metaError(400, "Meta connection state is invalid or expired.");
  }
  const stored = await readDocument<MetaOAuthStateDocument>(
    controlContainer(),
    stateId(state),
    stateId(state),
  );
  if (
    !stored ||
    stored.document.type !== "meta-oauth-state" ||
    Date.parse(stored.document.expiresAt) <= Date.now()
  ) {
    throw metaError(400, "Meta connection state is invalid or expired.");
  }
  return stored;
}

async function requireStateViewer(
  request: Request,
  state: MetaOAuthStateDocument,
): Promise<TenantContext> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  if (
    !viewer ||
    context.tenantId !== state.tenantId ||
    viewer.user.id !== state.requestedByUserId
  ) {
    throw metaError(403, "This Meta connection belongs to another session.");
  }
  return context;
}

async function updateOAuthState(
  stored: Versioned<MetaOAuthStateDocument>,
  status: MetaOAuthStateDocument["status"],
  values: Partial<MetaOAuthStateDocument> = {},
): Promise<MetaOAuthStateDocument> {
  try {
    return (
      await replaceDocument(
        controlContainer(),
        {
          ...stored.document,
          ...values,
          status,
          ttl:
            status === "PENDING" || status === "AWAITING_SELECTION"
              ? OAUTH_STATE_SECONDS
              : CONSUMED_STATE_SECONDS,
          ...(["COMPLETED", "CANCELLED", "FAILED"].includes(status)
            ? { completedAt: new Date().toISOString() }
            : {}),
        },
        stored.etag,
      )
    ).document;
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw metaError(409, "Meta connection state was already used.");
    }
    throw error;
  }
}

export async function createMetaOAuthLink(
  request: Request,
): Promise<MetaOAuthStartView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  if (!viewer) throw metaError(401, "Sign in is required.");
  const config = parseMetaOAuthConfig(process.env);
  const state = await createOAuthState(context.tenantId, viewer.user.id);
  return { url: buildMetaOAuthAuthorizeUrl(config, state) };
}

async function graphRequest(
  url: URL,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
  } catch {
    throw metaError(503, "Meta could not be reached.");
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw metaError(502, "Meta rejected the connection request.");
  return result;
}

async function managedPages(
  config: ReturnType<typeof parseMetaOAuthConfig>,
  code: string,
): Promise<MetaManagedPageCandidate[]> {
  const tokenUrl = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`,
  );
  tokenUrl.searchParams.set("client_id", config.appId);
  tokenUrl.searchParams.set("client_secret", config.appSecret);
  tokenUrl.searchParams.set("redirect_uri", config.oauthRedirectUri);
  tokenUrl.searchParams.set("code", code);
  const shortToken = parseGraphResponse(
    shortTokenResponseSchema,
    await graphRequest(tokenUrl),
    "Meta returned an invalid access-token response.",
  );

  const longTokenUrl = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`,
  );
  longTokenUrl.searchParams.set("grant_type", "fb_exchange_token");
  longTokenUrl.searchParams.set("client_id", config.appId);
  longTokenUrl.searchParams.set("client_secret", config.appSecret);
  longTokenUrl.searchParams.set(
    "fb_exchange_token",
    shortToken.access_token,
  );
  const longToken = parseGraphResponse(
    shortTokenResponseSchema,
    await graphRequest(longTokenUrl),
    "Meta returned an invalid long-lived token response.",
  );

  const pagesUrl = new URL(
    `https://graph.facebook.com/${config.graphApiVersion}/me/accounts`,
  );
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  pagesUrl.searchParams.set("limit", "100");
  const pages = parseGraphResponse(
    managedPagesResponseSchema,
    await graphRequest(pagesUrl, {
      headers: { Authorization: `Bearer ${longToken.access_token}` },
    }),
    "Meta returned an invalid managed-Pages response.",
  );
  return pages.data.map((page) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
  }));
}

export async function completeMetaOAuthConnection(
  request: Request,
): Promise<MetaOAuthCompletion> {
  const callback = parseMetaOAuthCallback(new URL(request.url));
  const stored = await requiredOAuthState(callback.state);
  if (stored.document.status !== "PENDING") {
    throw metaError(409, "Meta connection state was already used.");
  }
  if (callback.outcome === "DENIED") {
    await updateOAuthState(stored, "CANCELLED");
    return { outcome: "CANCELLED" };
  }

  const processing = await updateOAuthState(stored, "PROCESSING");
  try {
    const pages = await managedPages(
      parseMetaOAuthConfig(process.env),
      callback.code,
    );
    if (pages.length === 0) {
      throw metaError(
        409,
        "No managed Facebook Pages were returned by Meta.",
      );
    }
    const current = await readDocument<MetaOAuthStateDocument>(
      controlContainer(),
      processing.id,
      processing.partitionKey,
    );
    if (!current) throw metaError(409, "Meta connection state was lost.");
    await updateOAuthState(current, "AWAITING_SELECTION", {
      encryptedCandidates: encryptJson(pages, META_TOKEN_KEY),
    });
    return { outcome: "SELECT_PAGE", state: callback.state };
  } catch (error) {
    const current = await readDocument<MetaOAuthStateDocument>(
      controlContainer(),
      processing.id,
      processing.partitionKey,
    );
    if (current) await updateOAuthState(current, "FAILED");
    throw error;
  }
}

function decryptCandidates(
  state: MetaOAuthStateDocument,
): MetaManagedPageCandidate[] {
  if (!state.encryptedCandidates) {
    throw metaError(400, "Meta connection state is invalid or expired.");
  }
  const parsed = z
    .array(
      z.object({
        id: pageIdSchema,
        name: pageNameSchema,
        accessToken: accessTokenSchema,
      }),
    )
    .max(100)
    .safeParse(decryptJson<unknown>(state.encryptedCandidates, META_TOKEN_KEY));
  if (!parsed.success) {
    throw metaError(503, "Meta connection state is invalid.");
  }
  return parsed.data;
}

export async function getMetaManagedPages(
  request: Request,
  state: string,
): Promise<MetaManagedPageSelectionView> {
  const stored = await requiredOAuthState(state);
  await requireStateViewer(request, stored.document);
  if (stored.document.status !== "AWAITING_SELECTION") {
    throw metaError(409, "Meta connection state is not ready for selection.");
  }
  return {
    state,
    pages: decryptCandidates(stored.document).map(({ id, name }) => ({
      id,
      name,
    })),
  };
}

async function updatePageSubscription(
  route: Pick<MetaProviderRoute, "pageId" | "pageAccessToken" | "graphApiVersion">,
  method: "POST" | "DELETE",
): Promise<void> {
  const url = new URL(
    `https://graph.facebook.com/${route.graphApiVersion}/${route.pageId}/subscribed_apps`,
  );
  if (method === "POST") {
    url.searchParams.set(
      "subscribed_fields",
      "messages,messaging_postbacks",
    );
  }
  const result = await graphRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${route.pageAccessToken}`,
    },
  });
  if (!successResponseSchema.safeParse(result).success) {
    throw metaError(502, "Meta returned an invalid subscription response.");
  }
}

async function persistConnection(
  context: TenantContext,
  userId: string,
  page: MetaManagedPageCandidate,
): Promise<MetaConnectionDocument> {
  const duplicates = await connectionsForPage(page.id);
  if (duplicates.some((item) => item.tenantId !== context.tenantId)) {
    throw metaError(409, "This Facebook Page is connected to another Business.");
  }
  const conflictingLegacy = legacyMetaRoutes().find(
    (route) =>
      route.pageId === page.id && route.tenantId !== context.tenantId,
  );
  if (conflictingLegacy) {
    throw metaError(409, "This Facebook Page is connected to another Business.");
  }
  const current = await readConnection(context.tenantId);
  const now = new Date().toISOString();
  const document: MetaConnectionDocument = {
    id: META_CONNECTION_ID,
    partitionKey: context.tenantId,
    type: "meta-messenger-connection",
    schemaVersion: 1,
    tenantId: context.tenantId,
    pageId: page.id,
    pageName: page.name,
    encryptedPageAccessToken: encryptJson(page.accessToken, META_TOKEN_KEY),
    graphApiVersion: metaGraphApiVersion(),
    connectedByUserId: userId,
    connectedAt: current?.document.connectedAt ?? now,
    updatedAt: now,
  };
  return current
    ? (await replaceDocument(controlContainer(), document, current.etag)).document
    : (await createDocument(controlContainer(), document)).document;
}

export async function selectMetaManagedPage(
  request: Request,
  input: unknown,
): Promise<MetaConnectionView> {
  const parsed = z
    .object({
      state: z.string().regex(META_OAUTH_STATE_PATTERN),
      pageId: pageIdSchema,
    })
    .strict()
    .parse(input);
  const stored = await requiredOAuthState(parsed.state);
  const context = await requireStateViewer(request, stored.document);
  if (stored.document.status !== "AWAITING_SELECTION") {
    throw metaError(409, "Meta connection state is not ready for selection.");
  }
  const page = decryptCandidates(stored.document).find(
    (candidate) => candidate.id === parsed.pageId,
  );
  if (!page) throw metaError(400, "The selected Facebook Page is invalid.");

  const route = {
    tenantId: context.tenantId,
    pageId: page.id,
    pageAccessToken: page.accessToken,
    appSecret: metaAppSecret(),
    verifyToken: metaWebhookVerifyToken(),
    graphApiVersion: metaGraphApiVersion(),
  };
  const previous = await readConnection(context.tenantId);
  const previousRoute =
    previous && previous.document.pageId !== page.id
      ? routeFromConnection(previous.document)
      : null;
  await updatePageSubscription(route, "POST");
  let previousWasUnsubscribed = false;
  try {
    if (previousRoute) {
      await updatePageSubscription(previousRoute, "DELETE");
      previousWasUnsubscribed = true;
    }
    const connection = await persistConnection(
      context,
      stored.document.requestedByUserId,
      page,
    );
    await updateOAuthState(stored, "COMPLETED", {
      encryptedCandidates: undefined,
    });
    return connectionView(context, connection);
  } catch (error) {
    if (!previous || previous.document.pageId !== page.id) {
      try {
        await updatePageSubscription(route, "DELETE");
      } catch {
        console.error(
          JSON.stringify({
            event: "meta-page-subscription-rollback-failed",
            pageId: page.id,
          }),
        );
      }
    }
    if (previousRoute && previousWasUnsubscribed) {
      try {
        await updatePageSubscription(previousRoute, "POST");
      } catch {
        console.error(
          JSON.stringify({
            event: "meta-previous-page-resubscribe-failed",
            pageId: previousRoute.pageId,
          }),
        );
      }
    }
    throw error;
  }
}

export async function disconnectMetaPage(
  request: Request,
): Promise<MetaConnectionView> {
  const viewer = await getRequestViewer(request);
  const context = requireTenantContext(viewer);
  requireCompanyAdmin(context);
  const current = await readConnection(context.tenantId);
  if (!current) {
    throw metaError(404, "No BookSimple-managed Meta connection was found.");
  }
  await updatePageSubscription(routeFromConnection(current.document), "DELETE");
  await deleteDocument(
    controlContainer(),
    current.document.id,
    current.document.partitionKey,
    current.etag,
  );
  return connectionView(context, null);
}
