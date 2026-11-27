// Estimated payoff date for a loan.
//
// Monthly payment: the median of the monthly totals paid into the loan account over the last 3
// complete months (at least 2 months with a payment). When the rate is known (from Settings) and
// there's balance history, the payment used is principal + interest instead (how much the balance
// fell + that month's interest), which leaves out escrow (taxes and insurance) that doesn't pay
// down the loan.
// Interest rate: the one entered in Settings → Household details → Loan interest rates; otherwise
// estimated from the balance history: each month, interest = payment − how much the balance fell,
// and monthly rate = interest ÷ the balance at the start of the month (median over the months).
// Months left: the standard amortization formula n = −ln(1 − r·B/P) / ln(1 + r), so more of each
// payment going to principal over time is accounted for.

import type { NetWorthHistory, Transaction } from "./types";

export const PAYOFF_MONTHS = 3;
/** Above this, an estimated rate is probably escrow or a one-off, not interest: ask for the real rate. */
const MAX_ESTIMATED_RATE = 25;

export type Payoff =
  | {
      status: "ok";
      date: Date;
      months: number;
      payment: number;
      /** "principal-interest": worked out from the balance history (escrow left out); "paid": what was paid in. */
      paymentKind: "paid" | "principal-interest";
      annualRate: number;
      rateSource: "settings" | "estimated";
      paymentMonths: string[];
    }
  | { status: "paid" }
  | { status: "no-payments" }
  | { status: "need-rate"; payment: number; paymentMonths: string[] }
  | { status: "never"; payment: number; paymentKind: "paid" | "principal-interest"; annualRate: number; rateSource: "settings" | "estimated" };

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The `n` complete months before `today`'s month, oldest first, as "YYYY-MM". */
function lastMonths(today: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(ymd(new Date(today.getFullYear(), today.getMonth() - i, 1)).slice(0, 7));
  return out;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Balance (owed, positive) on or before `day` from the history, or null. */
function balanceOn(rows: { date: string; value: number }[], day: string): number | null {
  let found: number | null = null;
  for (const r of rows) {
    if (r.date > day) break;
    found = r.value;
  }
  return found;
}

function historyFor(history: NetWorthHistory | null, id: number): { date: string; value: number }[] {
  const key = String(id);
  const rows: { date: string; value: number }[] = [];
  for (const h of history?.spData?.histories ?? []) {
    const raw = h.balances?.[key];
    const v = typeof raw === "string" ? Number(raw) : raw;
    if (h.date && typeof v === "number" && Number.isFinite(v)) rows.push({ date: h.date, value: Math.abs(v) });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface PayoffInput {
  userAccountId: number;
  /** Current balance owed (sign ignored). */
  balance: number;
  transactions: Transaction[];
  /** Balance history; only needed when there's no rate from Settings. */
  history: NetWorthHistory | null;
  /** Annual % from Settings, if entered. */
  savedRate: number | null;
  today?: Date;
}

export function computePayoff({ userAccountId, balance, transactions, history, savedRate, today = new Date() }: PayoffInput): Payoff {
  const owed = Math.abs(balance);
  if (owed < 0.01) return { status: "paid" };

  const months = lastMonths(today, PAYOFF_MONTHS);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (t.userAccountId !== userAccountId || !t.isCredit || t.isDuplicate || !t.transactionDate) continue;
    const m = t.transactionDate.slice(0, 7);
    if (months.includes(m)) byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(t.amount ?? 0));
  }
  const paid = months.filter((m) => (byMonth.get(m) ?? 0) > 0);
  if (paid.length < 2) return { status: "no-payments" };
  let payment = median(paid.map((m) => byMonth.get(m)!));
  let paymentKind: "paid" | "principal-interest" = "paid";

  // Balance at the start and end of each paid month, where the history has both.
  const rows = historyFor(history, userAccountId);
  const spans: { month: string; start: number; end: number }[] = [];
  for (const m of paid) {
    const [y, mo] = m.split("-").map(Number);
    const start = balanceOn(rows, ymd(new Date(y!, mo! - 1, 0))); // last day of the previous month
    const end = balanceOn(rows, ymd(new Date(y!, mo!, 0))); // last day of this month
    if (start !== null && end !== null && start > 0) spans.push({ month: m, start, end });
  }

  let r: number | null = null;
  let rateSource: "settings" | "estimated" = "settings";
  if (savedRate !== null && Number.isFinite(savedRate) && savedRate >= 0) {
    r = savedRate / 1200;
    // Principal + interest each month: leaves out escrow.
    const pi = spans.map((s) => s.start - s.end + r! * s.start).filter((v) => v > 0);
    if (pi.length >= 2) {
      payment = median(pi);
      paymentKind = "principal-interest";
    }
  } else {
    rateSource = "estimated";
    const rates = spans.map((s) => (byMonth.get(s.month)! - (s.start - s.end)) / s.start);
    if (rates.length) {
      const est = median(rates);
      if (est >= 0 && est * 1200 <= MAX_ESTIMATED_RATE) r = est;
    }
  }
  if (r === null) return { status: "need-rate", payment, paymentMonths: paid };

  const annualRate = r * 1200;
  let n: number;
  if (r === 0) n = owed / payment;
  else if (payment <= r * owed) return { status: "never", payment, paymentKind, annualRate, rateSource };
  else n = -Math.log(1 - (r * owed) / payment) / Math.log(1 + r);

  const monthsLeft = Math.ceil(n);
  const date = new Date(today.getFullYear(), today.getMonth() + monthsLeft, 1);
  return { status: "ok", date, months: monthsLeft, payment, paymentKind, annualRate, rateSource, paymentMonths: paid };
}

// ---------- Text ----------

export const monthYear = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });

/** "14 yr 3 mo", "8 mo" */
export function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr` : "", m ? `${m} mo` : ""].filter(Boolean).join(" ") || "under a month";
}
