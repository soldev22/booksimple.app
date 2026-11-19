import { AzureCliCredential } from "@azure/identity";
import {
  AUTH_CONTROL_CONTAINER_ID,
  AUTH_DATABASE_ID,
  AUTH_SESSIONS_CONTAINER_ID,
  AUTH_THROTTLES_CONTAINER_ID,
} from "../src/server/auth-storage";
import { CUSTOMER_CONTAINER_ID } from "../src/server/customer-types";
import { SERVICE_CONTAINER_ID } from "../src/server/service-types";
import {
  CHANNEL_IDENTITY_CONTAINER_ID,
  CONVERSATION_CONTAINER_ID,
} from "../src/server/conversation-types";
import { BOOKING_CONTAINER_ID } from "../src/server/booking-types";
import { BOOKING_CONFIRMATION_CONTAINER_ID } from "../src/server/booking-confirmation-types";
import { PAYMENT_CONTAINER_ID } from "../src/server/payment-types";
import { REMINDER_CONTAINER_ID } from "../src/server/reminder-types";

const API_VERSION = "2024-05-15";
const MANAGEMENT_ENDPOINT = "https://management.azure.com";
type ContainerDefinition = {
  id: string;
  partitionKeyPaths: string[];
  partitionKeyKind: "Hash" | "MultiHash";
  partitionKeyVersion?: 2;
  defaultTtl?: number;
};

const containerDefinitions: ContainerDefinition[] = [
  ...[
    AUTH_CONTROL_CONTAINER_ID,
    AUTH_SESSIONS_CONTAINER_ID,
    AUTH_THROTTLES_CONTAINER_ID,
  ].map((id) => ({
    id,
    partitionKeyPaths: ["/partitionKey"],
    partitionKeyKind: "Hash" as const,
    defaultTtl: -1,
  })),
  {
    id: CUSTOMER_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: SERVICE_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: CONVERSATION_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId", "/conversationId"],
    partitionKeyKind: "MultiHash",
    partitionKeyVersion: 2,
  },
  {
    id: CHANNEL_IDENTITY_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: BOOKING_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: BOOKING_CONFIRMATION_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: PAYMENT_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
  {
    id: REMINDER_CONTAINER_ID,
    partitionKeyPaths: ["/tenantId"],
    partitionKeyKind: "Hash",
  },
];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildResourcePath(): string {
  const endpoint = new URL(requiredEnvironment("COSMOS_DB_ENDPOINT"));
  const accountMatch = endpoint.hostname.match(
    /^([a-z0-9-]+)\.documents\.azure\.com$/i,
  );
  const subscriptionId = requiredEnvironment("AZURE_SUBSCRIPTION_ID");
  const resourceGroup = requiredEnvironment("AZURE_RESOURCE_GROUP");
  if (
    endpoint.protocol !== "https:" ||
    !accountMatch ||
    !/^[0-9a-f-]{36}$/i.test(subscriptionId)
  ) {
    throw new Error("The Cosmos endpoint or Azure resource coordinates are invalid.");
  }

  return [
    "/subscriptions",
    encodeURIComponent(subscriptionId),
    "resourceGroups",
    encodeURIComponent(resourceGroup),
    "providers/Microsoft.DocumentDB/databaseAccounts",
    encodeURIComponent(accountMatch[1]),
  ].join("/");
}

async function requestResource(
  path: string,
  token: string,
  method: "GET" | "PUT",
  body?: unknown,
): Promise<{ status: number; resource?: Record<string, unknown> }> {
  const response = await fetch(
    `${MANAGEMENT_ENDPOINT}${path}?api-version=${API_VERSION}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (response.status === 404 && method === "GET") {
    return { status: 404 };
  }
  if (!response.ok) {
    throw new Error(`Azure resource operation failed with status ${response.status}.`);
  }
  if (method === "PUT") {
    return { status: response.status };
  }
  const responseBody = await response.text();
  return {
    status: response.status,
    resource: responseBody
      ? (JSON.parse(responseBody) as Record<string, unknown>)
      : undefined,
  };
}

async function ensureResource(
  path: string,
  body: unknown,
  token: string,
): Promise<Record<string, unknown>> {
  const existing = await requestResource(path, token, "GET");
  if (existing.resource) {
    return existing.resource;
  }

  try {
    await requestResource(path, token, "PUT", body);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("message" in error) ||
      !String(error.message).includes("status 409")
    ) {
      throw error;
    }
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readback = await requestResource(path, token, "GET");
    if (readback.resource) {
      return readback.resource;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Azure resource readback timed out.");
}

function getProperties(resource: Record<string, unknown>) {
  const properties = resource.properties;
  if (!properties || typeof properties !== "object") {
    return null;
  }
  const definition = (properties as Record<string, unknown>).resource;
  return definition && typeof definition === "object"
    ? (definition as Record<string, unknown>)
    : null;
}

function verifyContainer(
  resource: Record<string, unknown>,
  expected: (typeof containerDefinitions)[number],
): void {
  const definition = getProperties(resource);
  const partitionKey = definition?.partitionKey as
    | { paths?: unknown; kind?: unknown; version?: unknown }
    | undefined;
  if (
    resource.name !== expected.id ||
    definition?.id !== expected.id ||
    !Array.isArray(partitionKey?.paths) ||
    partitionKey.paths.length !== expected.partitionKeyPaths.length ||
    partitionKey.paths.some(
      (path, index) => path !== expected.partitionKeyPaths[index],
    ) ||
    partitionKey.kind !== expected.partitionKeyKind ||
    (expected.partitionKeyVersion !== undefined &&
      partitionKey.version !== expected.partitionKeyVersion) ||
    ("defaultTtl" in expected
      ? definition?.defaultTtl !== expected.defaultTtl
      : definition?.defaultTtl !== undefined)
  ) {
    throw new Error(
      `Container ${expected.id} does not match the reviewed data schema; no automatic migration was attempted.`,
    );
  }
}

let phase = "configuration";

async function main(): Promise<void> {
  const path = buildResourcePath();
  phase = "Azure CLI credential";
  const credential = new AzureCliCredential();
  const accessToken = await credential.getToken(
    "https://management.azure.com/.default",
  );
  if (!accessToken) {
    throw new Error("Azure CLI did not provide a management-plane token.");
  }

  const databasePath = `${path}/sqlDatabases/${encodeURIComponent(AUTH_DATABASE_ID)}`;
  phase = "database provisioning";
  const database = await ensureResource(
    databasePath,
    { properties: { resource: { id: AUTH_DATABASE_ID } } },
    accessToken.token,
  );
  if (database.name !== AUTH_DATABASE_ID) {
    throw new Error("Database readback does not match the requested auth database.");
  }

  for (const definition of containerDefinitions) {
    phase = `container ${definition.id} provisioning`;
    const resource = await ensureResource(
      `${databasePath}/containers/${encodeURIComponent(definition.id)}`,
      {
        properties: {
          resource: {
            id: definition.id,
            partitionKey: {
              paths: definition.partitionKeyPaths,
              kind: definition.partitionKeyKind,
              ...(definition.partitionKeyVersion
                ? { version: definition.partitionKeyVersion }
                : {}),
            },
            ...("defaultTtl" in definition
              ? { defaultTtl: definition.defaultTtl }
              : {}),
          },
        },
      },
      accessToken.token,
    );
    verifyContainer(resource, definition);
    console.log(
      `Verified ${AUTH_DATABASE_ID}/${definition.id} (${definition.partitionKeyPaths.join(" + ")}${"defaultTtl" in definition ? ", TTL enabled" : ""}).`,
    );
  }
}

main().catch((error: unknown) => {
  const detail =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown })
      : {};
  const name = typeof detail.name === "string" ? detail.name : "UnknownError";
  const message =
    typeof detail.message === "string" &&
    detail.message.startsWith("Azure resource operation failed with status ")
      ? detail.message
      : "Check the endpoint, resource coordinates, and authorized Azure management-plane identity.";
  const status =
    typeof detail === "object" && "statusCode" in detail &&
    typeof detail.statusCode === "number"
      ? `, status ${detail.statusCode}`
      : "";
  console.error(`Database provisioning failed during ${phase} (${name}${status}). ${message}`);
  process.exitCode = 1;
});
