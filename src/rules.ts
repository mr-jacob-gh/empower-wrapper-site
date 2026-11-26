// Your spending-category rules: "every transaction from merchant X counts as slice Y".
//
// Saved on your service (/merchant-categories), keyed by transactions[].merchantId, so
// they're the same on every device. The category is saved as its name (e.g.
// "Groceries/Household"); names that aren't one of the spending slices (set by another
// client) are kept and listed, but don't change the chart.
//
// Changes show at once and are then saved one merchant at a time (PUT/DELETE), so saves
// from two devices never overwrite each other. A failed save is undone locally.
//
// Rules from the previous version lived in this browser, keyed by transaction name;
// legacyRules()/dropLegacyRules() let main.ts move them to the service once.

import { deleteMerchantCategory, getMerchantCategories, putMerchantCategory } from "./api";
import type { Transaction } from "./types";
import { SLICES, type SliceKey } from "./spending";

/** merchantId -> category name, as saved on the service. */
let rules = new Map<string, string>();
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
let generation = 0;

/** Re-read the list at most this often (picks up changes made on another device). */
const MAX_AGE_MS = 5 * 60 * 1000;

/** The slice a saved category name means: by label or key, case ignored ("Groceries" still means groceries). */
export function sliceFromCategory(name: string): SliceKey | null {
  const n = name.trim().toLowerCase();
  const hit = SLICES.find((s) => s.label.toLowerCase() === n || s.key === n);
  if (hit) return hit.key;
  return n === "groceries" || n === "household" ? "groceries" : null;
}

const categoryName = (slice: SliceKey): string => SLICES.find((s) => s.key === slice)?.label ?? slice;

/** Load the saved list (reusing it for 5 minutes unless forced). Rejects on failure. */
export function loadRules(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && loadedAt && Date.now() - loadedAt < MAX_AGE_MS) return Promise.resolve();
  const gen = generation;
  inFlight = getMerchantCategories()
    .then(({ data }) => {
      if (gen !== generation) return;
      rules = new Map((Array.isArray(data) ? data : []).filter((e) => e?.merchantId && e.category).map((e) => [e.merchantId, e.category]));
      loadedAt = Date.now();
    })
    .finally(() => {
      if (gen === generation) inFlight = null;
    });
  return inFlight;
}

export const rulesLoaded = (): boolean => loadedAt > 0;

/** Forget everything in memory (e.g. when the API key is removed). */
export function clearRules(): void {
  generation++;
  rules = new Map();
  loadedAt = 0;
  inFlight = null;
}

export interface RuleInfo {
  merchantId: string;
  /** The category name as saved. */
  category: string;
  /** The spending slice it means, or null if it isn't one of them. */
  slice: SliceKey | null;
}

export function ruleFor(t: Transaction): RuleInfo | undefined {
  return t.merchantId ? ruleById(t.merchantId) : undefined;
}

export function ruleById(merchantId: string): RuleInfo | undefined {
  const category = rules.get(merchantId);
  return category === undefined ? undefined : { merchantId, category, slice: sliceFromCategory(category) };
}

/**
 * Set (or with null, remove) a merchant's category. Shows at once; resolves once saved.
 * On failure the change is undone locally and the error is rethrown.
 */
export function setRule(merchantId: string, slice: SliceKey | null): Promise<void> {
  return setCategory(merchantId, slice ? categoryName(slice) : null);
}

/** Set (or with null, remove) a merchant's category name exactly as given (used to undo). */
export async function setCategory(merchantId: string, category: string | null): Promise<void> {
  if (!merchantId) return;
  const before = rules.get(merchantId);
  if (category) rules.set(merchantId, category);
  else rules.delete(merchantId);
  try {
    if (category) await putMerchantCategory(merchantId, category);
    else await deleteMerchantCategory(merchantId);
  } catch (err) {
    if (before === undefined) rules.delete(merchantId);
    else rules.set(merchantId, before);
    throw err;
  }
}

/** All saved rules. */
export function allRules(): RuleInfo[] {
  return [...rules].map(([merchantId, category]) => ({ merchantId, category, slice: sliceFromCategory(category) }));
}

// ---------- Rules from the previous version (in this browser, by transaction name) ----------

const LEGACY_KEY = "empower.spendingRules.v1";

/** The old rules' match key: description, case and spacing ignored. */
export const legacyNameKey = (t: Transaction): string =>
  (t.description || t.originalDescription || "").trim().replace(/\s+/g, " ").toLowerCase();

export function legacyRules(): { key: string; label: string; slice: SliceKey }[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}") as Record<string, { slice?: string; label?: string }>;
    return Object.entries(parsed)
      .filter(([, r]) => r && SLICES.some((s) => s.key === r.slice))
      .map(([key, r]) => ({ key, label: r.label ?? key, slice: r.slice as SliceKey }));
  } catch {
    return [];
  }
}

export function dropLegacyRules(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage blocked: nothing to remove */
  }
}
