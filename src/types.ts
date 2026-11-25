// Types for the Empower Local Service API (see openapi.yaml).
// Only the fields the UI uses are listed; responses contain more.

/** Account category. Known values are listed, but others may appear. */
export type AccountGroup =
  | "BANK"
  | "CREDIT_CARD"
  | "INVESTMENT"
  | "RETIREMENT"
  | "ESOP"
  | "ESPP"
  | "LOAN"
  | "MORTGAGE"
  | (string & {})
  | null;

export interface Account {
  userAccountId?: number;
  accountId?: string;
  name?: string;
  originalName?: string;
  firmName?: string;
  accountTypeGroup?: AccountGroup;
  productType?: string;
  balance?: number;
  isAsset?: boolean;
  creditLimit?: number | null;
  currency?: string;
  accountHolder?: string;
  /** Epoch milliseconds: when Empower last synced the account. */
  lastRefreshed?: number;
  closedDate?: string | null;
}

/** `GET /getSummary` or `GET /data/summary`. Not wrapped in spHeader/spData. */
export interface Summary {
  totalNetWorth?: number;
  totalAsset?: number;
  totalLiability?: number;
  assetPercentage?: number;
  liabilityPercentage?: number;
  bankAmount?: number;
  investmentAmount?: number;
  creditCardAmount?: number;
  loanAmount?: number;
  bankAssetPercentage?: number;
  investmentAssetPercentage?: number;
  creditCardLiabilityPercentage?: number;
  loanLiabilityPercentage?: number;
  empowerAccounts?: Account[];
  aggregatedAccounts?: Account[];
  notifications?: unknown[];
  isDelegate?: boolean;
}

export interface ApiErrorBody {
  error: string;
  httpStatus?: number | null;
}
