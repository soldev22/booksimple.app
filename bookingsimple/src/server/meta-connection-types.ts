export type MetaConnectionStatus =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "ENVIRONMENT";

export type MetaConnectionView = {
  status: MetaConnectionStatus;
  canManage: boolean;
  pageId?: string;
  pageName?: string;
  details?: string;
};

export type MetaOAuthStartView = {
  url: string;
};

export type MetaManagedPageView = {
  id: string;
  name: string;
};

export type MetaManagedPageSelectionView = {
  state: string;
  pages: MetaManagedPageView[];
};

export type MetaOAuthCompletion =
  | { outcome: "SELECT_PAGE"; state: string }
  | { outcome: "CANCELLED" };
