import "server-only";

import { CosmosClient } from "@azure/cosmos";
import { AzureCliCredential, ClientAssertionCredential } from "@azure/identity";
import { getVercelOidcToken } from "@vercel/oidc";
import { getCosmosConfig } from "./cosmos-config";

let client: CosmosClient | undefined;

export function getCosmosClient(): CosmosClient {
  if (client) {
    return client;
  }

  const config = getCosmosConfig(process.env);
  if (config.authMode === "key") {
    client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    return client;
  }
  const credential =
    config.authMode === "azure-cli"
      ? new AzureCliCredential()
      : new ClientAssertionCredential(config.tenantId, config.clientId, () =>
          getVercelOidcToken({ audience: "api://AzureADTokenExchange" }),
        );

  client = new CosmosClient({
    endpoint: config.endpoint,
    aadCredentials: credential,
  });
  return client;
}
