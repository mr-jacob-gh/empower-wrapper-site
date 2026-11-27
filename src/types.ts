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

/** An account in the full `accounts` dataset: adds Empower's aggregation (connection) details. */
export interface AccountDetail extends Account {
  /** Null on healthy accounts; e.g. `{ type: "MFA_REQUIRED", tags: ["UAR", "MFA_REQUIRED"] }`. */
  aggregationError?: { type?: string; tags?: string[] } | string | null;
  nextAction?: {
    /** "RECONNECT" when the user must reconnect; absent on healthy accounts. */
    nextActionLinkType?: string;
    /** e.g. "NONE", "INITIATE_REFRESH" */
    action?: string;
    statusMessage?: string;
    /** "NO_ERROR" on healthy accounts. */
    aggregationErrorType?: string;
  } | null;
  isRefetchTransactionEligible?: boolean;
}

/** `GET /data/accounts`: every account with full detail. */
export interface Accounts {
  spData?: {
    accounts?: AccountDetail[];
  };
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
  accountName?: string;
  merchantId?: string;
  transactionDate?: string;
  /** Always positive; `isCredit` gives the direction. */
  amount?: number;
  isCredit?: boolean;
  isDuplicate?: boolean;
  description?: string;
  originalDescription?: string;
  /** Joins to categories[].transactionCategoryId: use this (not categoryName/categoryType) to group and filter. */
  categoryId?: number;
  /** Display label only; can differ from the category's name. */
  categoryName?: string;
  /** Usually the category's type, but not always (e.g. DEFERRED_COMPENSATION). Don't group by it. */
  categoryType?: string;
  transactionType?: string;
  status?: string;
  /** Investment transactions. */
  price?: number;
  quantity?: number;
}

/** `GET /data/transactions`: all accounts (default: last 1 year). */
export interface Transactions {
  spData?: {
    startDate?: string;
    endDate?: string;
    transactions?: Transaction[];
  };
}

/** Money in/out for one account in one month. Amounts are positive, except `expense` can be negative (refunds). */
export interface CashFlow {
  cashIn?: number;
  cashOut?: number;
  income?: number;
  expense?: number;
}

/** `GET /data/cashFlowHistory`: monthly cash flow for every account (default: last 1 year). */
export interface CashFlowHistory {
  spData?: {
    intervalType?: string;
    /** One row per month, dated the 1st; the last row is the current, partial month. */
    histories?: {
      date?: string;
      aggregateCashIn?: number;
      aggregateCashOut?: number;
      aggregateIncome?: number;
      aggregateExpense?: number;
      /** Keyed by userAccountId as a string; only accounts with data that month. */
      cashflows?: Record<string, CashFlow | undefined>;
    }[];
  };
}

export interface TransactionCategory {
  transactionCategoryId?: number;
  name?: string;
  /** EXPENSE | INCOME | TRANSFER | UNCATEGORIZED */
  type?: string;
  transactionCategoryKey?: string;
}

/** `GET /data/categories`: lookup table for transactions[].categoryId. */
export interface Categories {
  spData?: TransactionCategory[];
}

/** `/merchant-categories`: your own category name for a merchant, saved on the PC. */
export interface MerchantCategory {
  /** Matches transactions[].merchantId. */
  merchantId: string;
  /** Free text, 1–100 characters. */
  category: string;
}

/** One institution login (all the accounts behind one set of bank credentials). */
export interface InstitutionResult {
  institution?: string;
  userSiteId?: number;
  accounts?: number;
  /** refreshed | skipped | failed */
  action?: string;
  reason?: string | null;
  error?: string | null;
  lastRefreshedBefore?: string | null;
  lastRefreshedAfter?: string | null;
  /** True once Empower finished; false if it was still updating when the wait ended. */
  completed?: boolean | null;
  aggregationError?: string | null;
}

/** `GET /refresh-institutions` (and the body of its POST responses). */
export interface InstitutionRefreshStatus {
  enabled?: boolean;
  dailyAt?: string | null;
  intervalMinutes?: number;
  running?: boolean;
  /** schedule | startup | manual */
  trigger?: string | null;
  lastStarted?: string | null;
  lastFinished?: string | null;
  lastCompleted?: string | null;
  nextScheduledRun?: string | null;
  outcome?: string | null;
  error?: string | null;
  institutions?: InstitutionResult[];
}

export interface ApiErrorBody {
  error: string;
  httpStatus?: number | null;
}
