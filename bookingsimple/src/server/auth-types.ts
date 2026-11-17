export type CompanyRole = "company_admin" | "company_user";

export type TenantContext = {
  tenantId: string;
  businessName: string;
  username: string;
  role: CompanyRole;
};

export type UserView = {
  id: string;
  email: string;
  name: string;
  status: "pending" | "active" | "disabled" | "deleted";
  platformAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  membership?: {
    tenantId: string;
    username: string;
    role: CompanyRole;
  };
  application?: {
    businessId: string;
    businessName: string;
    status: "pending" | "approved" | "rejected";
  };
};

export type Viewer = {
  user: UserView;
  mfaVerified: boolean;
  tenant?: TenantContext;
};

export type BusinessView = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected" | "disabled";
  memberCount: number;
  createdAt: string;
};
