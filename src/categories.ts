// Transaction category filter: Income, Expenses, Transfers, Uncategorized (based on
// web-app-category-filter.md, but only the four groups; individual categories aren't offered).
//
// A transaction's group is the `type` of its category, found by looking up
// `categoryId` in /data/categories. `categoryName` and `categoryType` on the
// transaction are never used for grouping or matching: the name is a display
// label that can differ from the category, and the type can disagree with it.

import type { Transaction, TransactionCategory as TxnCategory } from "./types";

export type Group = "EXPENSE" | "INCOME" | "TRANSFER";
/** "ALL" | a group | "UNCATEGORIZED". */
export type Selection = string;

export const ALL = "ALL";
export const UNCATEGORIZED = "UNCATEGORIZED";
/** In dropdown order. */
export const GROUPS: readonly [Group, string][] = [
  ["INCOME", "Income"],
  ["EXPENSE", "Expenses"],
  ["TRANSFER", "Transfers"],
];

export interface CategoryIndex {
  byId: Map<number, TxnCategory>;
  /** The category's type, or undefined when its categoryId isn't in the list. */
  groupOf(t: Transaction): string | undefined;
  isUncategorized(t: Transaction): boolean;
  matches(t: Transaction, selection: Selection): boolean;
  /** Whether `selection` is one the dropdown offers. */
  isValid(selection: Selection): boolean;
  /** Dropdown label for a selection, without the count. */
  labelOf(selection: Selection): string;
}

export function indexCategories(categories: TxnCategory[]): CategoryIndex {
  const byId = new Map<number, TxnCategory>();
  for (const c of categories) if (typeof c.transactionCategoryId === "number") byId.set(c.transactionCategoryId, c);

  const groupOf = (t: Transaction) => (typeof t.categoryId === "number" ? byId.get(t.categoryId)?.type : undefined);
  const isUncategorized = (t: Transaction) => {
    const g = groupOf(t);
    return g === UNCATEGORIZED || g === undefined;
  };
  const isGroup = (s: Selection): s is Group => GROUPS.some(([type]) => type === s);

  return {
    byId,
    groupOf,
    isUncategorized,
    matches(t, selection) {
      if (selection === ALL) return true;
      if (selection === UNCATEGORIZED) return isUncategorized(t);
      return isGroup(selection) && groupOf(t) === selection;
    },
    isValid: (selection) => selection === ALL || selection === UNCATEGORIZED || isGroup(selection),
    labelOf(selection) {
      if (selection === ALL) return "All transactions";
      if (selection === UNCATEGORIZED) return "Uncategorized";
      return GROUPS.find(([type]) => type === selection)?.[1] ?? "Unknown";
    },
  };
}

/** Log each transaction whose categoryId isn't in the category list (once per pair of loads). */
const warned = new WeakMap<object, WeakSet<object>>();
export function warnUnknownCategories(transactions: Transaction[], categories: TxnCategory[], index: CategoryIndex): void {
  let seen = warned.get(transactions);
  if (!seen) warned.set(transactions, (seen = new WeakSet()));
  if (seen.has(categories)) return;
  seen.add(categories);
  for (const t of transactions) {
    if (index.groupOf(t) === undefined) console.warn("Unknown categoryId", t.categoryId, t.userTransactionId);
  }
}

export interface FilterOption {
  value: Selection;
  label: string;
  count: number;
}

/** Income, Expenses, Transfers, Uncategorized, with counts for `transactions` (the currently loaded ones). */
export function filterOptions(transactions: Transaction[], index: CategoryIndex): FilterOption[] {
  const counts = new Map<string, number>();
  for (const t of transactions) {
    const key = index.isUncategorized(t) ? UNCATEGORIZED : index.groupOf(t)!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    ...GROUPS.map(([type, label]) => ({ value: type, label, count: counts.get(type) ?? 0 })),
    { value: UNCATEGORIZED, label: "Uncategorized", count: counts.get(UNCATEGORIZED) ?? 0 },
  ];
}
