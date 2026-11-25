// 24-hour and 90-day trends for investment-type accounts, from the saved
// `performance` file (GET /data/performance, default range: last 90 days). No Empower call.
//
// Both come straight from accountSummaries: market gain/loss (excluding deposits and
// withdrawals) over the last day and over the file's whole range, each also shown as a
// fraction of the balance at the start of that period.
//
// Results are kept in memory only, for this tab, and are never written to browser
// storage, the repo or the service.

import { ApiError, getPerformance } from "./api";
import type { Performance } from "./types";

/** A change in dollars, plus that change as a fraction of the starting balance when known. */
export interface Change {
  value: number;
  fraction: number | null;
}

export interface AccountTrend {
  day: Change | null;
  /** Over the file's whole range (90 days by default). */
  range: Change | null;
}

export type TrendState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      byId: Map<number, AccountTrend>;
      /** First and last dates in the file (`yyyy-MM-dd`), when it has daily rows. */
      from: string | null;
      to: string | null;
      fetchedAt: number;
    }
  | { status: "error"; message: string };

/** Re-read the file at most this often unless forced (the service rewrites it every 15 minutes). */
const MAX_AGE_MS = 5 * 60 * 1000;

let state: TrendState = { status: "idle" };
let inFlight: Promise<void> | null = null;
/** Bumped by clearTrends() so a response that arrives afterwards is dropped. */
let generation = 0;

export function trendState(): TrendState {
  return state;
}

/** Forget everything (e.g. when the API key is removed). */
export function clearTrends(): void {
  generation++;
  inFlight = null;
  state = { status: "idle" };
}

/**
 * Load trends unless fresh ones are already in memory (or `force`).
 * Calls `onChange` whenever the state changes. Rejects only for key problems
 * (`ApiError` kind "unauthorized" / "no-key"); other failures land in the state.
 */
export function ensureTrends(force: boolean, onChange: () => void): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && state.status === "ready" && Date.now() - state.fetchedAt < MAX_AGE_MS) {
    return Promise.resolve();
  }

  const gen = generation;
  // Keep showing older numbers while new ones load.
  if (state.status !== "ready") {
    state = { status: "loading" };
    onChange();
  }

  const run = (async () => {
    let next: TrendState;
    try {
      const { data } = await getPerformance();
      next = { status: "ready", byId: buildTrends(data), ...dateSpan(data), fetchedAt: Date.now() };
    } catch (err) {
      if (isKeyError(err)) throw err;
      next = { status: "error", message: describe(err) };
    }
    if (gen !== generation) return;
    state = next;
  })();

  const tracked = run.finally(() => {
    if (gen !== generation) return;
    inFlight = null;
    onChange();
  });
  inFlight = tracked;
  return tracked;
}

// ---------- Building trends ----------

function buildTrends(data: Performance): Map<number, AccountTrend> {
  const byId = new Map<number, AccountTrend>();
  for (const s of data.spData?.accountSummaries ?? []) {
    if (!isNum(s.userAccountId)) continue;
    byId.set(s.userAccountId, {
      day: change(s.oneDayPerformanceValueChange, s.oneDayBalanceValueChange, s.currentBalance ?? s.balanceAsOfEndDate),
      range: change(s.dateRangePerformanceValueChange, s.dateRangeBalanceValueChange, s.balanceAsOfEndDate ?? s.currentBalance),
    });
  }
  return byId;
}

/**
 * Market gain/loss (`performance`), as a fraction of the balance at the start of the
 * period (end balance minus the balance change over the period).
 */
function change(performance: number | undefined, balanceChange: number | undefined, endBalance: number | undefined): Change | null {
  if (!isNum(performance)) return null;
  const start = isNum(endBalance) && isNum(balanceChange) ? endBalance - balanceChange : NaN;
  return { value: performance, fraction: start > 0 ? performance / start : null };
}

/** First and last dates in performanceHistory, for the tooltip. */
function dateSpan(data: Performance): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const row of data.spData?.performanceHistory ?? []) {
    const d = row.date;
    if (typeof d !== "string") continue;
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
  }
  return { from, to };
}

// ---------- Helpers ----------

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function isKeyError(err: unknown): boolean {
  return err instanceof ApiError && (err.kind === "unauthorized" || err.kind === "no-key");
}

function describe(err: unknown): string {
  if (err instanceof ApiError && err.kind === "network") return "Couldn't reach the service.";
  if (err instanceof ApiError && err.kind === "not-found") return "The service hasn't saved the performance data yet.";
  return err instanceof Error ? err.message : String(err);
}
