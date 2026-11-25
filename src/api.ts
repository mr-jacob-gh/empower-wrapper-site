import type { ApiErrorBody, NetWorthHistory, Performance, Summary, Transactions } from "./types";
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
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<Fetched<T>> {
  const key = getApiKey();
  if (!key) throw new ApiError("No API key entered.", "no-key");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { Accept: "application/json", "X-API-Key": key },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Couldn't reach the service at ${API_BASE}.`, "network");
  }

  if (!res.ok) {
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
    data: (await res.json()) as T,
    savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
  };
}

/** The saved `summary` dataset. Reads the service's file; does not call Empower. */
export function getSummary(signal?: AbortSignal): Promise<Fetched<Summary>> {
  return getJson<Summary>("/data/summary", signal);
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

/** The saved `transactions` dataset: all accounts, month to date. No Empower call. */
export function getTransactions(signal?: AbortSignal): Promise<Fetched<Transactions>> {
  return getJson<Transactions>("/data/transactions", signal);
}
