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

/** Per-account change over a date range (`performance.spData.accountSummaries[]`). */
export interface AccountSummary {
  userAccountId?: number;
  accountName?: string;
  currentBalance?: number;
  balanceAsOfEndDate?: number;
  /** Balance change over the range, including deposits and withdrawals. */
  dateRangeBalanceValueChange?: number;
  /** Market gain/loss over the range, excluding deposits and withdrawals. */
  dateRangePerformanceValueChange?: number;
  oneDayBalanceValueChange?: number;
  oneDayPerformanceValueChange?: number;
  closedDate?: string | null;
}

/** `GET /data/performance`: investment, retirement, ESOP and ESPP accounts. */
export interface Performance {
  spData?: {
    /**
     * Daily rows: `date`, `aggregatePerformance`, plus one property per account named by its
     * userAccountId (e.g. `"1527851081": 0.0123`) and a matching `"<id>Annotation"` string.
     * Only `date` is used here (for the range shown in tooltips).
     */
    performanceHistory?: PerformanceRow[];
    /** Changes over the dataset's whole range (90 days by default), plus one-day changes. */
    accountSummaries?: AccountSummary[];
  };
}

export interface PerformanceRow {
  date?: string;
  [key: string]: number | string | undefined;
}

/** `GET /data/netWorthHistory`: daily balances (default: last year). */
export interface NetWorthHistory {
  spData?: {
    /**
     * One row per day. `balances` keys are userAccountIds as strings; ignore keys
     * ending in "Annotation".
     */
    histories?: {
      date?: string;
      balances?: Record<string, number | string | undefined>;
    }[];
  };
}

export interface Transaction {
  userTransactionId?: number;
  userAccountId?: number;
  transactionDate?: string;
  /** Always positive; `isCredit` gives the direction. */
  amount?: number;
  isCredit?: boolean;
  isDuplicate?: boolean;
  description?: string;
  originalDescription?: string;
  categoryName?: string;
  transactionType?: string;
  status?: string;
  /** Investment transactions. */
  price?: number;
  quantity?: number;
}

/** `GET /data/transactions`: all accounts (default: month to date). */
export interface Transactions {
  spData?: {
    startDate?: string;
    endDate?: string;
    transactions?: Transaction[];
  };
}

export interface ApiErrorBody {
  error: string;
  httpStatus?: number | null;
}
