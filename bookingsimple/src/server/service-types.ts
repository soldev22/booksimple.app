import type { ItemDefinition } from "@azure/cosmos";

export const SERVICE_SCHEMA_VERSION = 1;
export const SERVICE_CONTAINER_ID = "services";

export type ServiceDocument = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "service";
  schemaVersion: typeof SERVICE_SCHEMA_VERSION;
  name: string;
  searchName: string;
  description?: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServiceView = {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ServicePage = {
  services: ServiceView[];
  defaultCurrency: string;
  continuationToken?: string;
};
