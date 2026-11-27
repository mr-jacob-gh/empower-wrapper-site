// Details only the saved `accounts` dataset carries (the summary doesn't): which accounts Empower
// can't update until they're reconnected, and available balance / available credit.

import type { AccountDetail, Accounts } from "./types";

export interface Reconnect {
  /** Empower's error type, e.g. "MFA_REQUIRED"; "RECONNECT" when only the link type says so. */
  type: string;
  /** Plain-language reason, e.g. "Extra verification (MFA) required". Empty when Empower gave no specific type. */
  label: string;
  /** Empower's own message for the account, if any. */
  message: string | null;
}

const LABELS: Record<string, string> = {
  MFA_REQUIRED: "Extra verification (MFA) required",
  RECONNECT: "",
};

const label = (type: string): string => {
  const known = LABELS[type];
  if (known !== undefined) return known;
  const words = type.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Null for healthy accounts. An account needs reconnecting when it has an
 * `aggregationError`, its `nextAction.nextActionLinkType` is "RECONNECT", or
 * `nextAction.aggregationErrorType` is anything but "NO_ERROR".
 */
export function reconnectInfo(a: AccountDetail): Reconnect | null {
  const err = a.aggregationError;
  const errType = typeof err === "string" ? err : err && typeof err === "object" ? (err.type ?? null) : null;
  const next = a.nextAction;
  const linkSaysReconnect = next?.nextActionLinkType === "RECONNECT";
  const nextType = next?.aggregationErrorType && next.aggregationErrorType !== "NO_ERROR" ? next.aggregationErrorType : null;
  if (!err && !linkSaysReconnect && !nextType) return null;
  const type = errType || nextType || "RECONNECT";
  const message = next?.statusMessage?.trim() || null;
  return { type, label: label(type), message };
}

let byId = new Map<number, Reconnect>();
let details = new Map<number, AccountDetail>();

/** Index the saved accounts dataset (null clears it). */
export function setAccountHealth(data: Accounts | null): void {
  const next = new Map<number, Reconnect>();
  const all = new Map<number, AccountDetail>();
  for (const a of data?.spData?.accounts ?? []) {
    if (typeof a.userAccountId !== "number") continue;
    all.set(a.userAccountId, a);
    const info = reconnectInfo(a);
    if (info) next.set(a.userAccountId, info);
  }
  byId = next;
  details = all;
}

const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Bank accounts: what can be spent now, if the accounts dataset has it. */
export const availableBalance = (userAccountId: number | undefined): number | null =>
  typeof userAccountId === "number" ? amount(details.get(userAccountId)?.availableBalance) : null;

/**
 * When Empower last heard from the bank for this account (epoch ms). The accounts dataset is the
 * source the service documents for this; the summary's copy can lag behind. Falls back to `fallback`
 * (the summary's value) when the accounts dataset doesn't have the account.
 */
export function lastRefreshedFor(userAccountId: number | undefined, fallback: number | undefined): number | undefined {
  const v = typeof userAccountId === "number" ? details.get(userAccountId)?.lastRefreshed : undefined;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Credit cards: limit minus balance owed, if the accounts dataset has it. */
export const availableCredit = (userAccountId: number | undefined): number | null =>
  typeof userAccountId === "number" ? amount(details.get(userAccountId)?.availableCredit) : null;

export const needsReconnect = (userAccountId: number | undefined): Reconnect | null =>
  typeof userAccountId === "number" ? (byId.get(userAccountId) ?? null) : null;
