// Debt-to-income ratio: average monthly debt payments ÷ gross monthly income.
//
// Debt payments come from the saved transactions over the last 3 complete calendar months:
//   1. Payments into linked loan and mortgage accounts (credits on loan accounts; recognised like the
//      dashboard does, by accountTypeGroup or, when that's null, productType "LOAN").
//   2. Payments into linked credit cards: credits on credit card accounts categorized as a credit
//      card payment (other credits on a card are refunds, so they're left out).
//   3. Money out of other accounts categorized as a mortgage, loan or credit card payment
//      ("Mortgages", "Loans", "Student Loans", "Credit Card Payments", ...), for debts that
//      aren't linked.
// A payment seen on both sides (out of checking and into the linked loan or card: same amount,
// within 5 days) counts once. Credit card payments are what was actually paid, which is often the
// whole statement rather than the minimum payment a lender would use.

import type { Account, Transaction, TransactionCategory } from "./types";
import { groupInfo } from "./dashboard";

export const DTI_MONTHS = 3;
const MATCH_DAYS = 5;
const isCardPayment = (name: string): boolean => /credit\s*card\s*payment/i.test(name);
const isDebtCategory = (name: string): boolean => /mortgage|loan/i.test(name) || isCardPayment(name);

export interface DtiSource {
  name: string;
  /** Average per month over the window. */
  monthly: number;
  count: number;
}

export interface Dti {
  /** monthlyDebt ÷ monthlyIncome; null without an income. */
  ratio: number | null;
  monthlyDebt: number;
  monthlyIncome: number | null;
  /** Months averaged over, oldest first, as "YYYY-MM". */
  months: string[];
  sources: DtiSource[];
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayNum = (s: string): number => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

/** The last `n` complete months before `endYmd`'s month that the data fully covers. */
function windowMonths(startYmd: string | undefined, endYmd: string, n: number): string[] {
  const [y, m] = endYmd.split("-").map(Number);
  const months: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(y ?? 1970, (m ?? 1) - 1 - i, 1);
    const first = ymd(d);
    if (!startYmd || first >= startYmd) months.push(first.slice(0, 7));
  }
  return months;
}

export function computeDti(
  txns: Transaction[],
  categories: TransactionCategory[] | null,
  accounts: Account[],
  annualIncome: number | null,
  range: { start?: string; end?: string },
): Dti {
  const end = range.end ?? ymd(new Date());
  const months = windowMonths(range.start, end, DTI_MONTHS);
  const inWindow = new Set(months);
  const catName = new Map((categories ?? []).map((c) => [c.transactionCategoryId, c.name ?? ""]));
  const kind = new Map(accounts.map((a) => [a.userAccountId, groupInfo(a).category]));
  const name = new Map(accounts.map((a) => [a.userAccountId, a.name || a.originalName || "Loan"]));

  const categoryOf = (t: Transaction): string =>
    (t.categoryId !== undefined ? catName.get(t.categoryId) : undefined) ?? t.categoryName ?? "";

  /** Payments received by a linked loan, mortgage or credit card account. */
  const loanIn: Transaction[] = [];
  /** Payments out of other accounts, by category. */
  const categorized: Transaction[] = [];
  for (const t of txns) {
    if (t.isDuplicate || !t.transactionDate || !inWindow.has(t.transactionDate.slice(0, 7))) continue;
    const amount = Math.abs(t.amount ?? 0);
    if (!amount) continue;
    const k = kind.get(t.userAccountId);
    if (k === "loans") {
      if (t.isCredit) loanIn.push(t);
    } else if (k === "credit") {
      if (t.isCredit && isCardPayment(categoryOf(t))) loanIn.push(t);
    } else if (!t.isCredit && isDebtCategory(categoryOf(t))) {
      categorized.push(t);
    }
  }

  // Drop categorized payments that are the other side of a linked-loan payment.
  const unmatched = [...loanIn];
  const outside = categorized.filter((t) => {
    const i = unmatched.findIndex(
      (l) =>
        Math.abs(Math.abs(l.amount ?? 0) - Math.abs(t.amount ?? 0)) < 0.01 &&
        Math.abs(dayNum(l.transactionDate!) - dayNum(t.transactionDate!)) <= MATCH_DAYS,
    );
    if (i < 0) return true;
    unmatched.splice(i, 1);
    return false;
  });

  const bySource = new Map<string, { total: number; count: number }>();
  const add = (key: string, amount: number) => {
    const s = bySource.get(key) ?? { total: 0, count: 0 };
    s.total += amount;
    s.count += 1;
    bySource.set(key, s);
  };
  for (const t of loanIn) add(name.get(t.userAccountId) ?? t.accountName ?? "Loan", Math.abs(t.amount ?? 0));
  for (const t of outside) add(t.description || t.categoryName || "Loan payment", Math.abs(t.amount ?? 0));

  const n = Math.max(months.length, 1);
  const sources = [...bySource.entries()]
    .map(([key, s]) => ({ name: key, monthly: s.total / n, count: s.count }))
    .sort((a, b) => b.monthly - a.monthly);
  const monthlyDebt = sources.reduce((t, s) => t + s.monthly, 0);
  const monthlyIncome = annualIncome && annualIncome > 0 ? annualIncome / 12 : null;
  return {
    ratio: monthlyIncome && months.length ? monthlyDebt / monthlyIncome : null,
    monthlyDebt,
    monthlyIncome,
    months,
    sources,
  };
}
