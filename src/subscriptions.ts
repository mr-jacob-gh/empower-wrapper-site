// Subscriptions: recurring charges found in the saved transactions (last 12 months).
//
// How a subscription is recognised:
// 1. Candidates are money-out, non-duplicate charges whose category is in the Expense
//    group (or Uncategorized). Transfers, card payments, income and retirement
//    contributions drop out, and so do recurring bills that aren't subscriptions
//    (loans, mortgages, rent, taxes, ATM/cash, checks).
// 2. Charges are grouped by merchant across all accounts (merchantId, or a normalised
//    description), so moving a subscription to another card doesn't split it.
// 3. A group is a subscription when the typical gap between charges matches a schedule
//    (weekly ... yearly), most gaps fit it (one missed charge allowed), it has enough
//    charges for that schedule, and the amount is steady (up to two price changes).
//    Variable spending (groceries, fuel, restaurants) fails the amount test.
// 4. If the whole group doesn't fit, its charges are split by amount and each part is
//    tested on its own (e.g. two different plans with the same company).
// 5. It's active when the last charge isn't more than half a cycle overdue.

import type { Transaction, TransactionCategory } from "./types";
import { indexCategories, type CategoryIndex } from "./categories";
import { dayNumber } from "./chart";
import { esc, mediumDate, moneyCents, shortDate } from "./format";
import { icons } from "./icons";

export interface Cadence {
  key: string;
  label: string;
  /** Average days between charges. */
  days: number;
  /** Range of gaps (days) that count as this schedule. */
  lo: number;
  hi: number;
  /** Fewest charges needed to call it a subscription. */
  minCount: number;
  /** Calendar months to add for the next charge (0 = use days). */
  months: number;
}

export const CADENCES: Cadence[] = [
  { key: "weekly", label: "Weekly", days: 7, lo: 6, hi: 8, minCount: 4, months: 0 },
  { key: "biweekly", label: "Every 2 weeks", days: 14, lo: 12, hi: 16, minCount: 3, months: 0 },
  { key: "monthly", label: "Monthly", days: 30.44, lo: 26, hi: 35, minCount: 3, months: 1 },
  { key: "bimonthly", label: "Every 2 months", days: 60.88, lo: 54, hi: 68, minCount: 3, months: 2 },
  { key: "quarterly", label: "Every 3 months", days: 91.31, lo: 82, hi: 100, minCount: 2, months: 3 },
  { key: "semiannual", label: "Every 6 months", days: 182.62, lo: 168, hi: 197, minCount: 2, months: 6 },
  { key: "yearly", label: "Yearly", days: 365.25, lo: 350, hi: 380, minCount: 2, months: 12 },
];

/** Recurring, but not subscriptions. Matched against the category list's names. */
const EXCLUDED_CATEGORIES = new Set(["loans", "mortgages", "rent", "taxes", "atm/cash", "checks", "wages paid"]);

export interface Subscription {
  key: string;
  name: string;
  cadence: Cadence;
  /** Charges, newest first. */
  charges: Transaction[];
  lastAmount: number;
  lastDate: string;
  nextDate: string;
  firstDate: string;
  /** Monthly equivalent of the latest amount. */
  monthlyCost: number;
  account: string;
  category: string;
  /** Set when the price changed: the amount before the latest change, and when it changed. */
  priceChange: { from: number; on: string } | null;
  /** How many listed subscriptions share this merchant (2+ means separate plans, told apart by price). */
  sameMerchant: number;
  /** False for one that has stopped (only returned with includeEnded). */
  active: boolean;
}

const amountOf = (t: Transaction): number => (typeof t.amount === "number" ? Math.abs(t.amount) : 0);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Merchant grouping key: merchantId when Empower has one, else a cleaned-up description. */
function merchantKey(t: Transaction): string {
  if (t.merchantId) return `m:${t.merchantId}`;
  const words = (t.description || t.originalDescription || "")
    .toLowerCase()
    .replace(/\b(pos|ach|debit|purchase|recurring|autopay|online|www|com|net|inc|llc|ltd|co)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1)
    .slice(0, 3);
  return words.length ? `d:${words.join(" ")}` : "";
}

/** Steady amount: at most two changes of more than 3% (and 50¢), none bigger than 35%. */
function amountsSteady(charges: Transaction[]): boolean {
  let changes = 0;
  for (let i = 1; i < charges.length; i++) {
    const prev = amountOf(charges[i - 1]!);
    const cur = amountOf(charges[i]!);
    const diff = Math.abs(cur - prev);
    if (diff <= 0.5 || diff / Math.max(prev, 0.01) <= 0.03) continue;
    if (diff / Math.max(prev, 0.01) > 0.35) return false;
    changes++;
  }
  return changes <= 2 && changes < charges.length / 2;
}

/** The schedule these charges (oldest first) follow, or null. */
function cadenceOf(charges: Transaction[]): Cadence | null {
  const days = charges.map((t) => dayNumber(t.transactionDate!));
  const gaps = days.slice(1).map((d, i) => d - days[i]!);
  if (gaps.length === 0 || gaps.some((g) => g <= 2)) return null; // same-week repeats aren't a subscription
  const typical = median(gaps);
  const c = CADENCES.find((x) => typical >= x.lo && typical <= x.hi);
  if (!c) return null;

  // Each gap should be one cycle, or two (one missed charge, at most once).
  let fits = 0;
  let doubles = 0;
  const halfWidth = (c.hi - c.lo) / 2;
  for (const g of gaps) {
    const k = Math.round(g / c.days);
    if (k >= 1 && k <= 2 && Math.abs(g - k * c.days) <= halfWidth * k) {
      fits++;
      if (k === 2) doubles++;
    }
  }
  if (fits / gaps.length < 0.8 || doubles > 1) return null;

  const identical = charges.every((t) => Math.abs(amountOf(t) - amountOf(charges[0]!)) < 0.005);
  // A new monthly subscription may only have two charges so far: accept that when they're identical.
  const enough = charges.length >= c.minCount || (c.key === "monthly" && charges.length === 2 && identical);
  // Two charges a quarter, half-year or year apart are thin evidence: require the same amount.
  if (charges.length === 2 && c.minCount === 2 && !identical) return null;
  return enough ? c : null;
}

function addCadence(ymd: string, c: Cadence): string {
  const [y, m, d] = ymd.split("-").map(Number);
  let next: Date;
  if (c.months) {
    next = new Date(y!, m! - 1 + c.months, 1);
    const dim = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(d!, dim));
  } else {
    next = new Date(y!, m! - 1, d! + c.days);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

export interface DetectOptions {
  /** "Today" for the active check: the transactions file's end date. */
  asOf: string;
  categories: TransactionCategory[] | null;
  /** Account name for a userAccountId (falls back to the transaction's accountName). */
  accountName?: (userAccountId: number | undefined) => string | undefined;
  /** Also return subscriptions that have ended (active: false), e.g. to total past spending. */
  includeEnded?: boolean;
}

/** Active subscriptions (plus ended ones with includeEnded), most expensive (per month) first. */
export function detectSubscriptions(transactions: Transaction[], opts: DetectOptions): Subscription[] {
  const index: CategoryIndex | null = opts.categories ? indexCategories(opts.categories) : null;

  const isCandidate = (t: Transaction): boolean => {
    if (t.isCredit || t.isDuplicate || !t.transactionDate || !(amountOf(t) > 0)) return false;
    if (index) {
      const cat = typeof t.categoryId === "number" ? index.byId.get(t.categoryId) : undefined;
      if (cat && EXCLUDED_CATEGORIES.has((cat.name ?? "").toLowerCase())) return false;
      const group = index.groupOf(t);
      return group === "EXPENSE" || group === "UNCATEGORIZED" || group === undefined;
    }
    // No category list: fall back to the transaction's own type.
    return !["TRANSFER", "INCOME", "DEFERRED_COMPENSATION"].includes((t.categoryType ?? "").toUpperCase());
  };

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isCandidate(t)) continue;
    const key = merchantKey(t);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(t);
  }

  const asOfDay = dayNumber(opts.asOf);
  const found: Subscription[] = [];
  const byDate = (a: Transaction, b: Transaction) => (a.transactionDate! < b.transactionDate! ? -1 : a.transactionDate! > b.transactionDate! ? 1 : 0);

  const consider = (key: string, charges: Transaction[]): boolean => {
    if (charges.length < 2 || !amountsSteady(charges)) return false;
    const c = cadenceOf(charges);
    if (!c) return false;
    const last = charges[charges.length - 1]!;
    const lastDay = dayNumber(last.transactionDate!);
    const active = asOfDay - lastDay <= c.days + Math.max(7, c.days * 0.5);
    if (!active && !opts.includeEnded) return true; // a real subscription, but it has ended
    let priceChange: Subscription["priceChange"] = null;
    for (let i = charges.length - 1; i > 0; i--) {
      const a = amountOf(charges[i]!);
      const b = amountOf(charges[i - 1]!);
      if (Math.abs(a - b) > 0.5 && Math.abs(a - b) / b > 0.03) {
        priceChange = { from: b, on: charges[i]!.transactionDate! };
        break;
      }
    }
    const cat = index && typeof last.categoryId === "number" ? index.byId.get(last.categoryId) : undefined;
    found.push({
      key,
      name: last.description || last.originalDescription || "Subscription",
      cadence: c,
      charges: [...charges].reverse(),
      lastAmount: amountOf(last),
      lastDate: last.transactionDate!,
      nextDate: addCadence(last.transactionDate!, c),
      firstDate: charges[0]!.transactionDate!,
      monthlyCost: (amountOf(last) * 30.4375) / c.days,
      account: opts.accountName?.(last.userAccountId) ?? last.accountName ?? "",
      category: cat?.name ?? last.categoryName ?? "",
      priceChange,
      sameMerchant: 1,
      active,
    });
    return true;
  };

  for (const [key, list] of groups) {
    const charges = [...list].sort(byDate);
    if (consider(key, charges)) continue;
    // Not one subscription as a whole: try each amount level on its own.
    const levels: Transaction[][] = [];
    for (const t of [...charges].sort((a, b) => amountOf(a) - amountOf(b))) {
      const level = levels.find((l) => {
        const ref = amountOf(l[0]!);
        return Math.abs(amountOf(t) - ref) <= Math.max(0.5, ref * 0.03);
      });
      if (level) level.push(t);
      else levels.push([t]);
    }
    if (levels.length < 2) continue;
    levels.forEach((l, i) => consider(`${key}#${i}`, l.sort(byDate)));
  }

  const perMerchant = new Map<string, number>();
  for (const f of found) {
    const m = f.key.split("#")[0]!;
    perMerchant.set(m, (perMerchant.get(m) ?? 0) + 1);
  }
  for (const f of found) f.sameMerchant = perMerchant.get(f.key.split("#")[0]!) ?? 1;
  return found.sort((a, b) => b.monthlyCost - a.monthlyCost || a.name.localeCompare(b.name));
}

// ---------- Sorting ----------

export type SubSort = "name" | "next";
export const SUB_SORTS: [SubSort, string][] = [
  ["name", "Name"],
  ["next", "Next payment"],
];
export const isSubSort = (s: string | null): s is SubSort => s === "name" || s === "next";

const byName = (a: Subscription, b: Subscription) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const byNext = (a: Subscription, b: Subscription) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0);

/** A sorted copy: A–Z by name (ties: soonest next), or soonest next payment (ties: name). */
export function sortSubscriptions(subs: Subscription[], sort: SubSort): Subscription[] {
  return [...subs].sort(sort === "next" ? (a, b) => byNext(a, b) || byName(a, b) : (a, b) => byName(a, b) || byNext(a, b));
}

// ---------- Rendering ----------

export function subscriptionsShellHtml(): string {
  return `
  <div class="subs-screen">
    <div class="page-head">
      <div>
        <h1 tabindex="-1">Subscriptions</h1>
        <div class="muted small" data-role="subs-range">Recurring charges found in your transactions</div>
      </div>
    </div>
    <div data-role="subs-body">${subsLoadingHtml()}</div>
  </div>`;
}

export function subsLoadingHtml(): string {
  return `
    <section class="tiles subs-stats">${'<div class="card tile skeleton" aria-hidden="true"></div>'.repeat(3)}</section>
    <section class="card"><div class="skeleton skeleton--list" aria-busy="true" aria-label="Loading"></div></section>`;
}

const count = new Intl.NumberFormat("en-US");

function stat(label: string, value: string, note: string): string {
  return `
    <div class="card tile subs-stat">
      <div class="tile__label">${esc(label)}</div>
      <div class="tile__value">${esc(value)}</div>
      <div class="muted small">${esc(note)}</div>
    </div>`;
}

function subscriptionRow(s: Subscription): string {
  const id = `sub-${s.key.replace(/[^a-z0-9]+/gi, "-")}`;
  const meta = [
    `${count.format(s.charges.length)} charge${s.charges.length === 1 ? "" : "s"} since ${mediumDate(s.firstDate)}`,
    s.category && `Category: ${s.category}`,
    s.cadence.key !== "monthly" && `≈ ${moneyCents(s.monthlyCost)} a month`,
    s.priceChange && `Price changed from ${moneyCents(s.priceChange.from)} on ${mediumDate(s.priceChange.on)}`,
    s.sameMerchant > 1 && `One of ${s.sameMerchant} subscriptions with ${s.name}, told apart by price`,
  ].filter(Boolean) as string[];
  // Show the year when the next charge isn't this year (e.g. a yearly renewal).
  const next = s.nextDate.slice(0, 4) === String(new Date().getFullYear()) ? shortDate(s.nextDate) : mediumDate(s.nextDate);
  const charges = s.charges
    .map(
      (t) => `
        <li class="sub-charge">
          <span class="sub-charge__date">${esc(mediumDate(t.transactionDate!))}</span>
          <span class="sub-charge__desc">${esc(t.description || t.originalDescription || "")}<span class="sub-charge__acct">${esc(t.accountName ?? "")}</span></span>
          <span class="sub-charge__amt">−${esc(moneyCents(amountOf(t)))}${t.status?.toLowerCase() === "pending" ? ` <span class="tag tag--warn">Pending</span>` : ""}</span>
        </li>`,
    )
    .join("");
  return `
    <li class="sub" data-sub-key="${esc(s.key)}">
      <button type="button" class="sub__row" data-sub-toggle="${esc(s.key)}" aria-expanded="false" aria-controls="${esc(id)}">
        <span class="sub__avatar" aria-hidden="true">${esc((s.name.trim()[0] ?? "?").toUpperCase())}</span>
        <span class="sub__text">
          <span class="sub__name">${esc(s.name)}</span>
          <span class="sub__sub"><span class="sub__cadence">${icons.repeat}${esc(s.cadence.label)}</span>${s.account ? ` · ${esc(s.account)}` : ""}</span>
        </span>
        <span class="sub__amts">
          <span class="sub__amt">${esc(moneyCents(s.lastAmount))}</span>
          <span class="sub__next">Next ~${esc(next)}</span>
        </span>
        <span class="sub__chev" aria-hidden="true">${icons.chevronDown}</span>
      </button>
      <div class="sub__details" id="${esc(id)}" hidden>
        <p class="sub__meta">${meta.map(esc).join(" · ")}</p>
        <ul class="sub-charges">${charges}</ul>
      </div>
    </li>`;
}

/** Fill the screen body with totals and the list, in `sort` order. */
export function renderSubscriptions(
  screen: HTMLElement,
  found: Subscription[],
  range: { start?: string; end?: string },
  sort: SubSort,
): void {
  const subs = sortSubscriptions(found, sort);
  const rangeEl = screen.querySelector<HTMLElement>("[data-role='subs-range']");
  if (rangeEl && range.start && range.end) {
    rangeEl.textContent = `Recurring charges found in your transactions, ${mediumDate(range.start)} – ${mediumDate(range.end)}`;
  }
  const monthly = subs.reduce((n, s) => n + s.monthlyCost, 0);
  const body = screen.querySelector<HTMLElement>("[data-role='subs-body']")!;
  body.innerHTML = `
    <section class="tiles subs-stats" aria-label="Totals">
      ${stat("Active subscriptions", count.format(subs.length), subs.length ? `Across ${count.format(new Set(subs.map((s) => s.account).filter(Boolean)).size)} account(s)` : "None found")}
      ${stat("Per month", `≈ ${moneyCents(monthly)}`, "Latest prices, as a monthly equivalent")}
      ${stat("Per year", `≈ ${moneyCents(monthly * 12)}`, "If nothing changes")}
    </section>
    <section class="card subs-card" aria-label="Active subscriptions">
      ${
        subs.length
          ? `<div class="subs-toolbar">
              <span class="muted small" id="subs-sort-label">Sort by</span>
              <div class="seg" role="group" aria-labelledby="subs-sort-label">
                ${SUB_SORTS.map(([key, label]) => `<button type="button" class="seg__btn" data-sub-sort="${key}" aria-pressed="${key === sort}">${esc(label)}</button>`).join("")}
              </div>
            </div>
            <ul class="sub-list">${subs.map(subscriptionRow).join("")}</ul>`
          : `<p class="muted subs-empty">No active subscriptions found in your transactions.</p>`
      }
      <p class="subs-note muted small">Found by looking for charges from the same merchant that repeat on a regular schedule
        (weekly to yearly) at a steady price. Transfers, card payments, loans, mortgages, rent and taxes aren't counted.
        "Next" is an estimate from the schedule.</p>
    </section>`;
}
