import assert from "node:assert/strict";
import test from "node:test";
import { getCosmosConfig } from "../src/server/cosmos-config.ts";

const endpoint = "https://example.documents.azure.com/";

test("requires explicit endpoint and authentication mode", () => {
  assert.throws(() => getCosmosConfig({}), /COSMOS_DB_ENDPOINT/);
  assert.throws(
    () => getCosmosConfig({ COSMOS_DB_ENDPOINT: endpoint }),
    /COSMOS_AUTH_MODE/,
  );
  assert.throws(
    () => getCosmosConfig({ COSMOS_DB_ENDPOINT: endpoint, COSMOS_AUTH_MODE: "unknown" }),
    /COSMOS_AUTH_MODE/,
  );
});

test("key authentication requires a key and is limited to local development", () => {
  const environment = { COSMOS_DB_ENDPOINT: endpoint, COSMOS_AUTH_MODE: "key" };
  assert.throws(() => getCosmosConfig(environment), /COSMOS_DB_KEY/);
  assert.throws(() => getCosmosConfig({ ...environment, COSMOS_DB_KEY: "  " }), /COSMOS_DB_KEY/);
  assert.deepEqual(
    getCosmosConfig({ ...environment, COSMOS_DB_KEY: "example-key" }),
    { endpoint: "https://example.documents.azure.com", authMode: "key", key: "example-key" },
  );
  for (const deployment of [{ VERCEL: "1" }, { NODE_ENV: "production" }]) {
    assert.throws(
      () => getCosmosConfig({ ...environment, COSMOS_DB_KEY: "example-key", ...deployment }),
      /limited to local development/,
    );
  }
});

test("rejects insecure URLs and URLs containing credentials or paths", () => {
  for (const invalid of [
    "not-a-url",
    "http://example.documents.azure.com/",
    "https://user:password@example.documents.azure.com/",
    "https://example.documents.azure.com/db",
    "https://example.documents.azure.com/?secret=value",
  ]) {
    assert.throws(
      () => getCosmosConfig({ COSMOS_DB_ENDPOINT: invalid, COSMOS_AUTH_MODE: "azure-cli" }),
      /COSMOS_DB_ENDPOINT/,
    );
  }
});

test("Azure CLI mode is available locally but rejected on Vercel", () => {
  assert.deepEqual(
    getCosmosConfig({ COSMOS_DB_ENDPOINT: endpoint, COSMOS_AUTH_MODE: "azure-cli" }),
    { endpoint: "https://example.documents.azure.com", authMode: "azure-cli" },
  );
  assert.throws(
    () => getCosmosConfig({
      COSMOS_DB_ENDPOINT: endpoint,
      COSMOS_AUTH_MODE: "azure-cli",
      VERCEL: "1",
    }),
    /Vercel deployments/,
  );
});

test("Vercel OIDC requires both Entra identifiers", () => {
  const environment = { COSMOS_DB_ENDPOINT: endpoint, COSMOS_AUTH_MODE: "vercel-oidc" };
  assert.throws(() => getCosmosConfig(environment), /AZURE_TENANT_ID/);
  assert.throws(
    () => getCosmosConfig({ ...environment, AZURE_TENANT_ID: "tenant" }),
    /AZURE_CLIENT_ID/,
  );
  assert.deepEqual(
    getCosmosConfig({
      ...environment,
      AZURE_TENANT_ID: "tenant",
      AZURE_CLIENT_ID: "client",
    }),
    {
      endpoint: "https://example.documents.azure.com",
      authMode: "vercel-oidc",
      tenantId: "tenant",
      clientId: "client",
    },
  );
});
