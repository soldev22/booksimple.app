import type { ItemDefinition } from "@azure/cosmos";

export const CUSTOMER_SCHEMA_VERSION = 1;
export const CUSTOMER_CONTAINER_ID = "customers";

export type CustomerStatus = "active" | "archived" | "erased";

type CustomerDocumentBase = ItemDefinition & {
  id: string;
  tenantId: string;
  type: "customer";
  schemaVersion: typeof CUSTOMER_SCHEMA_VERSION;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerProfileDocument = CustomerDocumentBase & {
  status: "active" | "archived";
  name: string;
  searchName: string;
  email?: string;
  phone?: string;
  archivedAt?: string;
};

export type ErasedCustomerDocument = CustomerDocumentBase & {
  status: "erased";
  erasedAt: string;
};

export type CustomerDocument =
  | CustomerProfileDocument
  | ErasedCustomerDocument;

export type CustomerView = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerDuplicateWarning = {
  id: string;
  name: string;
  matchingFields: Array<"email" | "phone">;
};

export type CustomerMutationResult = {
  customer: CustomerView;
  warnings: CustomerDuplicateWarning[];
};

export type CustomerPage = {
  customers: CustomerView[];
  continuationToken?: string;
};
