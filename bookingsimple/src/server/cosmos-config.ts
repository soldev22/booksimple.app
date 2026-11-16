type Environment = Readonly<Record<string, string | undefined>>;

export type CosmosConfig =
  | { endpoint: string; authMode: "azure-cli" }
  | { endpoint: string; authMode: "key"; key: string }
  | {
      endpoint: string;
      authMode: "vercel-oidc";
      tenantId: string;
      clientId: string;
    };

function requiredValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getCosmosConfig(environment: Environment): CosmosConfig {
  const endpoint = requiredValue(environment, "COSMOS_DB_ENDPOINT");
  if (!URL.canParse(endpoint)) {
    throw new Error("COSMOS_DB_ENDPOINT must be a valid HTTPS account URL.");
  }

  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("COSMOS_DB_ENDPOINT must be a valid HTTPS account URL.");
  }

  const authMode = requiredValue(environment, "COSMOS_AUTH_MODE");
  if (authMode === "key") {
    if (environment.VERCEL === "1" || environment.NODE_ENV === "production") {
      throw new Error("Cosmos account-key authentication is limited to local development.");
    }
    return {
      endpoint: url.origin,
      authMode,
      key: requiredValue(environment, "COSMOS_DB_KEY"),
    };
  }
  if (authMode === "azure-cli") {
    if (environment.VERCEL === "1") {
      throw new Error("Vercel deployments must use vercel-oidc authentication.");
    }
    return { endpoint: url.origin, authMode };
  }

  if (authMode === "vercel-oidc") {
    return {
      endpoint: url.origin,
      authMode,
      tenantId: requiredValue(environment, "AZURE_TENANT_ID"),
      clientId: requiredValue(environment, "AZURE_CLIENT_ID"),
    };
  }

  throw new Error("COSMOS_AUTH_MODE must be key, azure-cli or vercel-oidc.");
}
