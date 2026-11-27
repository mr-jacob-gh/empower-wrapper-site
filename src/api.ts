import type {
  Accounts,
  ApiErrorBody,
  CashFlowHistory,
  Categories,
  InstitutionRefreshStatus,
  MerchantCategory,
  Setting,
  ZestimateList,
  NetWorthHistory,
  Performance,
  Summary,
  Transactions,
} from "./types";
import { getApiKey } from "./auth";

/**
 * Where the service lives.
 * - `npm run dev`: "/api", proxied by Vite to the service on this PC (see vite.config.ts).
 * - Production build: the public address (override with VITE_API_BASE).
 */
export const API_BASE: string = (
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? "/api" : "https://beefjerky67.asuscomm.com:44300")
).replace(/\/$/, "");

export type ApiErrorKind = "no-key" | "unauthorized" | "network" | "not-found" | "http";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Fetched<T> {
  data: T;
  /** When the service saved the file (from Last-Modified), if known. */
  savedAt: Date | null;
  /** HTTP status of the response. */
  status: number;
}

function getJson<T>(path: string, signal?: AbortSignal): Promise<Fetched<T>> {
  return request<T>("GET", path, undefined, signal);
}

/**
 * Any call to the service. `body` is sent as JSON. A 204 response gives `data: null`.
 * Non-2xx statuses listed in `accept` are returned (with their JSON body) instead of thrown.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  accept: readonly number[] = [],
): Promise<Fetched<T>> {
  const key = getApiKey();
  if (!key) throw new ApiError("No API key entered.", "no-key");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: {
        Accept: "application/json",
        "X-API-Key": key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Couldn't reach the service at ${API_BASE}.`, "network");
  }

  if (!res.ok && !accept.includes(res.status)) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiErrorBody>;
      if (body.error) message = body.error;
    } catch {
      /* body wasn't JSON */
    }
    const kind: ApiErrorKind =
      res.status === 401 ? "unauthorized" : res.status === 404 ? "not-found" : "http";
    throw new ApiError(message, kind, res.status);
  }

  const lastModified = res.headers.get("Last-Modified");
  const savedAt = lastModified ? new Date(lastModified) : null;
  return {
    data: (res.status === 204 ? null : await res.json()) as T,
    savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
    status: res.status,
  };
}

/** The saved `summary` dataset. Reads the service's file; does not call Empower. */
export function getSummary(signal?: AbortSignal): Promise<Fetched<Summary>> {
  return getJson<Summary>("/data/summary", signal);
}

/** The saved `accounts` dataset: full detail per account, including connection errors. No Empower call. */
export function getAccounts(signal?: AbortSignal): Promise<Fetched<Accounts>> {
  return getJson<Accounts>("/data/accounts", signal);
}

/**
 * The saved `performance` dataset: last 90 days of per-account performance for
 * investment-type accounts. Reads the service's file; does not call Empower.
 */
export function getPerformance(signal?: AbortSignal): Promise<Fetched<Performance>> {
  return getJson<Performance>("/data/performance", signal);
}

/** The saved `netWorthHistory` dataset: daily balances, last year (~270 KB). No Empower call. */
export function getNetWorthHistory(signal?: AbortSignal): Promise<Fetched<NetWorthHistory>> {
  return getJson<NetWorthHistory>("/data/netWorthHistory", signal);
}

/** The saved `transactions` dataset: all accounts, last 12 months. No Empower call. */
export function getTransactions(signal?: AbortSignal): Promise<Fetched<Transactions>> {
  return getJson<Transactions>("/data/transactions", signal);
}

/** The saved `cashFlowHistory` dataset: monthly money in/out per account, last year. No Empower call. */
export function getCashFlowHistory(signal?: AbortSignal): Promise<Fetched<CashFlowHistory>> {
  return getJson<CashFlowHistory>("/data/cashFlowHistory", signal);
}

/** The saved `categories` dataset: lookup table for transactions[].categoryId. No Empower call. */
export function getCategories(signal?: AbortSignal): Promise<Fetched<Categories>> {
  return getJson<Categories>("/data/categories", signal);
}

// ---------- Institution refresh (this one does reach Empower and every bank) ----------

/**
 * Ask Empower to pull fresh data from every institution, then re-fetch all datasets.
 * Starts in the background: `202` with the new status, or `409` with the status of the
 * run already in progress (both resolve; check `status`).
 * `force`: also refresh logins Empower refreshed in the last hour.
 */
export function startInstitutionRefresh(force: boolean): Promise<Fetched<InstitutionRefreshStatus>> {
  return request<InstitutionRefreshStatus>("POST", `/refresh-institutions${force ? "?force=true" : ""}`, undefined, undefined, [409]);
}

/** Progress or result of the last institution refresh. Doesn't call Empower. */
export function getInstitutionRefreshStatus(signal?: AbortSignal): Promise<Fetched<InstitutionRefreshStatus>> {
  return getJson<InstitutionRefreshStatus>("/refresh-institutions", signal);
}

// ---------- App settings (saved on the service; the same on every device) ----------

/** Every app setting (`[]` when none are saved). */
export function getSettings(signal?: AbortSignal): Promise<Fetched<Setting[]>> {
  return getJson<Setting[]>("/settings", signal);
}

/** Add or change the settings sent; others are left alone. Returns every setting. Nothing is saved if any entry is invalid. */
export function saveSettings(settings: Setting[]): Promise<Fetched<Setting[]>> {
  return request<Setting[]>("PATCH", "/settings", settings);
}

// ---------- Property values (Zillow Zestimate via APIllow) ----------

/** Saved Zestimates for every address the service tracks. Reads saved results only (no APIllow quota). */
export function getZestimates(signal?: AbortSignal): Promise<Fetched<ZestimateList>> {
  return getJson<ZestimateList>("/zestimate", signal);
}

// ---------- Your merchant categories (the only thing the app saves on the service) ----------

/** All saved merchant categories (`[]` when none). */
export function getMerchantCategories(signal?: AbortSignal): Promise<Fetched<MerchantCategory[]>> {
  return getJson<MerchantCategory[]>("/merchant-categories", signal);
}

/** Set one merchant's category (adds it, or changes it). Other entries are untouched. */
export function putMerchantCategory(merchantId: string, category: string): Promise<Fetched<MerchantCategory>> {
  return request<MerchantCategory>("PUT", `/merchant-categories/${encodeURIComponent(merchantId)}`, { category });
}

/** Remove one merchant's category. A 404 means it had none, which is fine. */
export async function deleteMerchantCategory(merchantId: string): Promise<void> {
  try {
    await request<null>("DELETE", `/merchant-categories/${encodeURIComponent(merchantId)}`);
  } catch (err) {
    if (!(err instanceof ApiError && err.kind === "not-found")) throw err;
  }
}
