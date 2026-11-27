// Spending: where money went, as a donut of seven slices, for a chosen period.
//
// Each spending transaction lands in exactly one slice, checked in this order:
// 0. Your rules (rules.ts, saved on the service by merchantId): every transaction from a
//    merchant you've assigned goes to that slice, whatever its category. A rule can also
//    bring in money that wouldn't count otherwise (e.g. a transfer you consider spending).
// 1. Subscriptions: charges that belong to a detected subscription (including ones
//    that have since ended, so past periods count them), from subscriptions.ts.
// 2. Restaurants, Groceries/Household, Utilities, Pets, Interest & Fees: by the category
//    list's name for the transaction's categoryId (Utilities also covers Cable/Satellite and
//    Telephone). Interest & Fees also takes money out in Empower's "Interest" category
//    (interest charged), which sits in the Income group; interest earned isn't spending.
// 3. Other shopping: every other Expense (or Uncategorized) transaction.
// Spending is money out in the Expense group; transfers, card payments and income
// aren't spending. Refunds in a slice (money in, Expense category) reduce it.

import type { Transaction, TransactionCategory } from "./types";
import { indexCategories, type CategoryIndex } from "./categories";
import { detectSubscriptions } from "./subscriptions";
import { dayNumber } from "./chart";
import { esc, mediumDate, moneyCents, money } from "./format";
import { allRules, ruleFor } from "./rules";

export type SliceKey = "restaurants" | "groceries" | "subscriptions" | "utilities" | "pets" | "fees" | "other";

export interface SliceDef {
  key: SliceKey;
  label: string;
  /**
   * Categorical colours, validated in ring order (each slice against its neighbours, including
   * the wrap-around pair) on the dark card surface.
   */
  color: string;
  /** Category names (lower case) that belong here; matched by the category list, not the transaction's label. */
  categories?: string[];
  /** Categories outside the Expense group whose money-out transactions belong here (e.g. interest charged). */
  debitCategories?: string[];
  note: string;
}

/** In ring and legend order. Colours follow the slice, never its rank. */
export const SLICES: SliceDef[] = [
  { key: "restaurants", label: "Restaurants", color: "#4c9bff", categories: ["restaurants"], note: "Restaurants category" },
  { key: "groceries", label: "Groceries/Household", color: "#ff8a4c", categories: ["groceries"], note: "Groceries category" },
  { key: "subscriptions", label: "Subscriptions", color: "#2fd3c4", note: "Charges from recurring subscriptions (see Subscriptions)" },
  {
    key: "utilities",
    label: "Utilities",
    color: "#f5b83d",
    categories: ["utilities", "cable/satellite", "telephone"],
    note: "Utilities, Cable/Satellite and Telephone categories",
  },
  { key: "pets", label: "Pets", color: "#a98bff", categories: ["pets/pet care"], note: "Pets/Pet Care category" },
  {
    key: "fees",
    label: "Interest & Fees",
    color: "#4ade80",
    categories: ["service charges/fees", "advisory fee"],
    debitCategories: ["interest"],
    note: "Service Charges/Fees and Advisory Fee categories, plus interest charged",
  },
  { key: "other", label: "Other shopping", color: "#e463c8", note: "Every other spending category" },
];
export const isSliceKey = (s: string | null): s is SliceKey => SLICES.some((x) => x.key === s);

export type RangeKey = "week" | "month" | "year" | "ytd";
export const RANGES: [RangeKey, string][] = [
  ["week", "Past week"],
  ["month", "Past month"],
  ["year", "Past year"],
  ["ytd", "This year"],
];
export const isRangeKey = (s: string | null): s is RangeKey => RANGES.some(([k]) => k === s);

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

/** Inclusive dates for a period ending on `asOf` (the data's last day). */
export function periodOf(range: RangeKey, asOf: string): { start: string; end: string } {
  const end = parse(asOf);
  let start: Date;
  if (range === "week") start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  else if (range === "ytd") start = new Date(end.getFullYear(), 0, 1);
  else {
    // The day after the same date last month/year (Mar 31 -> after Feb 28/29).
    const back = range === "month" ? 1 : 12;
    const first = new Date(end.getFullYear(), end.getMonth() - back, 1);
    const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    start = new Date(first.getFullYear(), first.getMonth(), Math.min(end.getDate(), dim) + 1);
  }
  return { start: ymd(start), end: asOf };
}

export interface SliceTotal extends SliceDef {
  /** Net spending (charges minus refunds), never below 0. */
  total: number;
  share: number;
  transactions: Transaction[];
}

export interface SpendingBreakdown {
  slices: SliceTotal[];
  total: number;
  period: { start: string; end: string };
  /** The period starts before the data does. */
  dataStart: string | null;
}

const amountOf = (t: Transaction): number => (typeof t.amount === "number" ? Math.abs(t.amount) : 0);

/** Which slice a transaction belongs to automatically (ignoring your rules), or null when it isn't spending. */
function classifier(all: Transaction[], categories: TransactionCategory[] | null, asOf: string) {
  const index: CategoryIndex | null = categories ? indexCategories(categories) : null;
  const subscriptionCharges = new Set<Transaction>();
  for (const s of detectSubscriptions(all, { asOf, categories, includeEnded: true })) {
    for (const t of s.charges) subscriptionCharges.add(t);
  }
  const byName = new Map<string, SliceKey>();
  const debitByName = new Map<string, SliceKey>();
  for (const s of SLICES) {
    for (const c of s.categories ?? []) byName.set(c, s.key);
    for (const c of s.debitCategories ?? []) debitByName.set(c, s.key);
  }

  return (t: Transaction): SliceKey | null => {
    if (t.isDuplicate || !t.transactionDate || !(amountOf(t) > 0)) return null;
    const catName = index && typeof t.categoryId === "number" ? index.byId.get(t.categoryId)?.name?.toLowerCase() : undefined;
    // Money out in a non-Expense category that a slice claims (interest charged).
    if (catName && !t.isCredit && debitByName.has(catName)) return debitByName.get(catName)!;
    if (index) {
      const group = index.groupOf(t);
      if (group !== "EXPENSE" && group !== "UNCATEGORIZED" && group !== undefined) return null;
    } else if (["TRANSFER", "INCOME", "DEFERRED_COMPENSATION"].includes((t.categoryType ?? "").toUpperCase())) {
      return null;
    }
    if (subscriptionCharges.has(t)) return "subscriptions";
    return (catName && byName.get(catName)) || "other";
  };
}

const classifiers = new WeakMap<object, WeakMap<object, ReturnType<typeof classifier>>>();
const NO_CATEGORIES = {};

/** The automatic classifier for this data, built once (subscription detection runs over all 12 months). */
function autoClassifier(all: Transaction[], categories: TransactionCategory[] | null, asOf: string) {
  let perData = classifiers.get(all);
  if (!perData) classifiers.set(all, (perData = new WeakMap()));
  let classify = perData.get(categories ?? NO_CATEGORIES);
  if (!classify) perData.set(categories ?? NO_CATEGORIES, (classify = classifier(all, categories, asOf)));
  return classify;
}

export interface SliceInfo {
  /** Where it goes on its own (null: not spending). */
  auto: SliceKey | null;
  /** Your rule for its name, if any. */
  manual: SliceKey | null;
}

/** For a transaction: its automatic slice and your rule. */
export function sliceResolver(all: Transaction[], categories: TransactionCategory[] | null, asOf: string): (t: Transaction) => SliceInfo {
  const auto = autoClassifier(all, categories, asOf);
  return (t) => ({ auto: auto(t), manual: ruleFor(t)?.slice ?? null });
}

/** The slice a transaction counts in: your rule first (if it names a slice), then the automatic one. */
function finalSlice(t: Transaction, auto: (t: Transaction) => SliceKey | null): SliceKey | null {
  const rule = ruleFor(t);
  if (rule?.slice) {
    return t.isDuplicate || !t.transactionDate || !(amountOf(t) > 0) ? null : rule.slice;
  }
  return auto(t);
}

/** Spending by slice for `range`, newest transactions first in each slice. */
export function spendingBreakdown(
  all: Transaction[],
  categories: TransactionCategory[] | null,
  range: RangeKey,
  asOf: string,
  dataStart?: string,
): SpendingBreakdown {
  const auto = autoClassifier(all, categories, asOf);

  const period = periodOf(range, asOf);
  const from = dayNumber(period.start);
  const to = dayNumber(period.end);
  const buckets = new Map<SliceKey, { net: number; txns: Transaction[] }>(SLICES.map((s) => [s.key, { net: 0, txns: [] }]));
  for (const t of all) {
    const day = t.transactionDate ? dayNumber(t.transactionDate) : NaN;
    if (!(day >= from && day <= to)) continue;
    const key = finalSlice(t, auto);
    if (!key) continue;
    const b = buckets.get(key)!;
    b.net += t.isCredit ? -amountOf(t) : amountOf(t);
    b.txns.push(t);
  }
  const totals = SLICES.map((s) => ({ s, b: buckets.get(s.key)! }));
  const total = totals.reduce((n, { b }) => n + Math.max(0, b.net), 0);
  return {
    slices: totals.map(({ s, b }) => ({
      ...s,
      total: Math.max(0, b.net),
      share: total > 0 ? Math.max(0, b.net) / total : 0,
      transactions: b.txns.sort(
        (a, c) => c.transactionDate!.localeCompare(a.transactionDate!) || (c.userTransactionId ?? 0) - (a.userTransactionId ?? 0),
      ),
    })),
    total,
    period,
    dataStart: dataStart && dataStart > period.start ? dataStart : null,
  };
}

// ---------- Rendering ----------

const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("en-US");

export function spendingShellHtml(): string {
  return `
  <div class="spend-screen">
    <div class="page-head">
      <div>
        <h1 tabindex="-1">Spending</h1>
        <div class="muted small" data-role="spend-range">Where your money went</div>
      </div>
      <div class="seg spend-ranges" role="group" aria-label="Period">
        ${RANGES.map(([k, label]) => `<button type="button" class="seg__btn" data-spend-range="${k}" aria-pressed="false">${esc(label)}</button>`).join("")}
      </div>
    </div>
    <section class="card spend-card" aria-label="Spending by category">
      <div data-role="spend-chart"><div class="skeleton skeleton--chart" aria-busy="true" aria-label="Loading"></div></div>
    </section>
    <section class="card spend-list" data-role="spend-list" aria-live="polite"></section>
  </div>`;
}

/** SVG path for a donut segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
function arc(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const pt = (rad: number, a: number) => `${(cx + rad * Math.sin(a)).toFixed(2)} ${(cy - rad * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  // A full circle can't be drawn as one arc: split it.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M ${pt(r, 0)} A ${r} ${r} 0 1 1 ${pt(r, Math.PI)} A ${r} ${r} 0 1 1 ${pt(r, 0)} Z M ${pt(inner, 0)} A ${inner} ${inner} 0 1 0 ${pt(inner, Math.PI)} A ${inner} ${inner} 0 1 0 ${pt(inner, 0)} Z`;
  }
  return `M ${pt(r, a0)} A ${r} ${r} 0 ${large} 1 ${pt(r, a1)} L ${pt(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${pt(inner, a0)} Z`;
}

/**
 * The donut, legend and centre total. `selected` slice is pulled out; the rest dim.
 * `merchantName` names a merchantId for the rules list.
 */
export function renderSpendingChart(
  screen: HTMLElement,
  b: SpendingBreakdown,
  range: RangeKey,
  selected: SliceKey | null,
  merchantName: (merchantId: string) => string | undefined = () => undefined,
): void {
  for (const btn of screen.querySelectorAll<HTMLElement>("[data-spend-range]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.spendRange === range));
  }
  const rangeEl = screen.querySelector<HTMLElement>("[data-role='spend-range']")!;
  rangeEl.textContent = `${mediumDate(b.period.start)} – ${mediumDate(b.period.end)}${b.dataStart ? ` (data starts ${mediumDate(b.dataStart)})` : ""}`;

  const host = screen.querySelector<HTMLElement>("[data-role='spend-chart']")!;
  if (b.total <= 0) {
    host.innerHTML = `<p class="muted spend-empty">No spending in this period.</p>`;
    return;
  }

  const size = 260;
  const c = size / 2;
  const r = 118;
  const inner = 74;
  let a = 0;
  const paths = b.slices
    .filter((s) => s.total > 0)
    .map((s) => {
      const a0 = a;
      const a1 = a + s.share * Math.PI * 2;
      a = a1;
      const mid = (a0 + a1) / 2;
      const pull = selected === s.key ? 8 : 0;
      const dim = selected && selected !== s.key ? " is-dim" : "";
      return `<path class="spend-slice${dim}" data-spend-slice="${s.key}" d="${arc(c, c, r, inner, a0, a1)}" fill="${s.color}"
        transform="translate(${(pull * Math.sin(mid)).toFixed(2)} ${(-pull * Math.cos(mid)).toFixed(2)})"/>`;
    })
    .join("");

  const sel = b.slices.find((s) => s.key === selected);
  const centre = sel
    ? `<span class="spend-centre__label">${esc(sel.label)}</span><span class="spend-centre__value">${esc(money(sel.total))}</span><span class="spend-centre__note">${esc(pct.format(sel.share))} of spending</span>`
    : `<span class="spend-centre__label">Spent</span><span class="spend-centre__value">${esc(money(b.total))}</span><span class="spend-centre__note">${esc(RANGES.find(([k]) => k === range)?.[1] ?? "")}</span>`;

  const rulesOpen = host.querySelector<HTMLDetailsElement>(".spend-rules")?.open ?? false;
  const legend = b.slices
    .map(
      (s) => `
      <li>
        <button type="button" class="spend-key${s.total === 0 ? " is-zero" : ""}" data-spend-slice="${s.key}" aria-pressed="${selected === s.key}"
          title="${esc(s.note)}">
          <span class="spend-key__swatch" style="background:${s.color}" aria-hidden="true"></span>
          <span class="spend-key__name">${esc(s.label).replace(/\//g, "/<wbr>")}</span>
          <span class="spend-key__amt">${esc(moneyCents(s.total))}</span>
          <span class="spend-key__pct">${esc(pct.format(s.share))}</span>
        </button>
      </li>`,
    )
    .join("");

  host.innerHTML = `
    <div class="spend-layout">
      <div class="spend-donut">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
          aria-label="Spending by category, ${esc(money(b.total))} in total. Use the list to pick a category.">${paths}</svg>
        <div class="spend-centre" aria-hidden="true">${centre}</div>
        <div class="spend-tip" role="status" hidden></div>
      </div>
      <ul class="spend-legend" aria-label="Categories">${legend}</ul>
    </div>
    ${rulesHtml(merchantName)}`;
  const rulesBox = host.querySelector<HTMLDetailsElement>(".spend-rules");
  if (rulesBox && rulesOpen) rulesBox.open = true;

  // Hover tooltip on the slices (the legend carries the same figures for keyboard and touch).
  const svg = host.querySelector<SVGSVGElement>("svg")!;
  const tip = host.querySelector<HTMLElement>(".spend-tip")!;
  svg.addEventListener("pointermove", (e) => {
    const key = (e.target as Element).closest<SVGElement>("[data-spend-slice]")?.dataset.spendSlice;
    const s = b.slices.find((x) => x.key === key);
    if (!s) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = `<strong>${esc(s.label)}</strong><span>${esc(moneyCents(s.total))} · ${esc(pct.format(s.share))}</span>`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, e.clientX - box.left - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(0, e.clientY - box.top - tip.offsetHeight - 14)}px`;
  });
  svg.addEventListener("pointerleave", () => (tip.hidden = true));
}

/** Your merchant categories, to review, change or remove. Empty when there are none. */
function rulesHtml(merchantName: (merchantId: string) => string | undefined): string {
  const rules = allRules()
    .map((r) => ({ ...r, name: merchantName(r.merchantId) ?? r.merchantId }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  if (!rules.length) return "";
  const options = (r: (typeof rules)[number]) =>
    (r.slice ? "" : `<option value="" selected disabled>${esc(r.category)} (not used)</option>`) +
    SLICES.map((s) => `<option value="${s.key}"${s.key === r.slice ? " selected" : ""}>${esc(s.label)}</option>`).join("");
  return `
    <details class="spend-rules">
      <summary>Your merchant categories <span class="count">${count.format(rules.length)}</span></summary>
      <p class="muted small">Every transaction from one of these merchants counts in the category you chose. Saved on your service, so they're the same on every device.</p>
      <ul>
        ${rules
          .map(
            (r) => `
          <li class="spend-rule"${r.slice ? "" : ` title="“${esc(r.category)}” isn't one of the spending categories, so the chart ignores it. Pick one to use it here."`}>
            <span class="spend-rule__name" title="Merchant ID ${esc(r.merchantId)}">${esc(r.name)}</span>
            <select class="spend-rule__select" data-rule-key="${esc(r.merchantId)}" data-rule-label="${esc(r.name)}" aria-label="Category for ${esc(r.name)}">${options(r)}</select>
            <button type="button" class="link-btn small" data-rule-remove="${esc(r.merchantId)}" aria-label="Remove the category for ${esc(r.name)}">Remove</button>
          </li>`,
          )
          .join("")}
      </ul>
    </details>`;
}

/** Heading for the transaction list under the chart. */
export function spendingListHeadHtml(b: SpendingBreakdown, selected: SliceKey | null): string {
  const s = b.slices.find((x) => x.key === selected);
  if (!s) {
    return `<p class="muted spend-hint">Select a category in the chart or the list to see its transactions.</p>`;
  }
  return `
    <header class="card-head">
      <div>
        <h2 class="card-head__title"><span class="spend-key__swatch" style="background:${s.color}" aria-hidden="true"></span>${esc(s.label)}
          <span class="count">${count.format(s.transactions.length)}</span></h2>
        <div class="muted small">${esc(mediumDate(b.period.start))} – ${esc(mediumDate(b.period.end))} · ${esc(moneyCents(s.total))} · ${esc(s.note)}</div>
      </div>
      <button type="button" class="link-btn small" data-spend-slice="${s.key}">Clear</button>
    </header>`;
}
