// Accounts Empower can't update until the user reconnects them (from the saved
// `accounts` dataset, which carries aggregation details the summary doesn't).

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

/** Index the saved accounts dataset (null clears it). */
export function setAccountHealth(data: Accounts | null): void {
  const next = new Map<number, Reconnect>();
  for (const a of data?.spData?.accounts ?? []) {
    const info = typeof a.userAccountId === "number" ? reconnectInfo(a) : null;
    if (info) next.set(a.userAccountId!, info);
  }
  byId = next;
}

export const needsReconnect = (userAccountId: number | undefined): Reconnect | null =>
  typeof userAccountId === "number" ? (byId.get(userAccountId) ?? null) : null;
