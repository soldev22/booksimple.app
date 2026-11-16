export type UserView = {
  id: string;
  email: string;
  name: string;
  status: "pending" | "active" | "disabled";
  platformAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
  membership?: {
    tenantId: string;
    username: string;
    role: "company_admin" | "company_user";
  };
  application?: {
    businessName: string;
    status: "pending" | "approved" | "rejected";
  };
};

export type Viewer = {
  user: UserView;
  mfaVerified: boolean;
};

export type BusinessView = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected" | "disabled";
};
