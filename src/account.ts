// The account screen: details, transactions (10 per page) and, for investment-type
// accounts, 24h/90d trends and a balance chart. Data comes from saved files only
// (netWorthHistory, transactions).

import type { NetWorthHistory, Transaction, TransactionCategory, Transactions } from "./types";
import { ALL, filterOptions, indexCategories, warnUnknownCategories, type CategoryIndex, type Selection } from "./categories";
import { filterBoxHtml, updateFilterBox, type BoxOption, type FilterState } from "./filterbox";
import { dateTime, esc, mediumDate, moneyCents, moneyParts, monthYear, shortDate, signedPercent, timeAgo } from "./format";
import { icons } from "./icons";
import { hasTrends, signedBalance, syncedHtml, type GroupInfo, type Row } from "./dashboard";
import { dayNumber, mountLineChart, type Point } from "./chart";

export type ChartRange = "24h" | "90d";
export const PAGE_SIZE = 10;

type Found = Row & { info: GroupInfo };

const signedCents = (n: number): string =>
  (n > 0 ? "+" : n < 0 ? "−" : "") + moneyCents(Math.abs(n));

// ---------- Shell ----------

export function accountScreenHtml(found: Found, range: ChartRange): string {
  return `
  <div class="acct-screen">
    <button type="button" class="btn btn--accent back-btn" data-action="back">${icons.arrowLeft}<span>Back to summary</span></button>
    ${heroHtml(found)}
    ${hasTrends(found.info) ? chartCardHtml(range) : ""}
    <section class="card txn-card" aria-labelledby="txn-title">
      <header class="card-head">
        <div>
          <h2 id="txn-title" class="card-head__title">Transactions <span class="count" data-role="txn-count" hidden></span></h2>
          <div class="muted small" data-role="txn-range"></div>
          <div class="txn-totals small" data-role="txn-totals" hidden></div>
        </div>
        ${filterBoxHtml()}
      </header>
      <div data-role="txn-body">${loadingBlock("list")}</div>
    </section>
  </div>`;
}

function chartCardHtml(range: ChartRange): string {
  return `
    <section class="card chart-card" aria-labelledby="chart-title">
      <header class="card-head">
        <div>
          <h2 id="chart-title" class="card-head__title">Balance</h2>
          <div class="chart-card__change" data-role="chart-change"></div>
        </div>
        <div class="seg" role="group" aria-label="Time range">
          ${(["24h", "90d"] as const)
            .map((r) => `<button type="button" class="seg__btn" data-range="${r}" aria-pressed="${r === range}">${r}</button>`)
            .join("")}
        </div>
      </header>
      <div data-role="chart-body">${loadingBlock("chart")}</div>
    </section>`;
}

/** Singular names for the hero and details (group labels are plural). */
const TYPE_LABEL: Partial<Record<string, string>> = {
  BANK: "Cash",
  INVESTMENT: "Investment",
  CREDIT_CARD: "Credit card",
  LOAN: "Loan",
};

/** Name, balance, details and, for investment-type accounts, 24h/90d pills (filled by applyTrends). */
export function heroHtml({ account: a, isEmpower, info }: Found): string {
  const balance = signedBalance(a, info);
  const [whole, cents] = moneyParts(balance);
  const synced = a.lastRefreshed ? new Date(a.lastRefreshed) : null;
  const type = TYPE_LABEL[a.accountTypeGroup ?? ""] ?? info.label;
  // productType is an enum like "CHECKING" or "CREDIT_CARD": show it as "Checking", unless it repeats the type.
  const product = (a.productType ?? "").replace(/_/g, " ").toLowerCase().trim();
  const productLabel = product && product !== type.toLowerCase() ? product[0]!.toUpperCase() + product.slice(1) : "";
  const limit = typeof a.creditLimit === "number" && a.creditLimit > 0 ? a.creditLimit : null;
  // Values are HTML: escaped here, so "Last synced" can carry its warning icon.
  const details: [string, string][] = [
    ["Institution", esc(a.firmName ?? "")],
    ["Type", esc([type, productLabel].filter(Boolean).join(" · "))],
    ["Account holder", esc(a.accountHolder ?? "")],
    ["Credit limit", limit !== null ? esc(moneyCents(limit)) : ""],
    ["Available credit", limit !== null ? esc(moneyCents(Math.max(0, limit - Math.abs(balance)))) : ""],
    ["Last synced", synced ? syncedHtml(a.lastRefreshed, `${dateTime(synced)} (${timeAgo(synced)})`) : ""],
  ];
  return `
  <section class="card acct-hero" data-role="hero">
    <div class="acct-hero__top">
      <div class="acct__icon">${info.icon}</div>
      <div class="acct-hero__titles">
        <h1 class="acct-hero__name">${esc(a.name || a.originalName || "Account")}${isEmpower ? ` <span class="tag">Empower</span>` : ""}</h1>
        <div class="muted small">${[a.firmName, type].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
    </div>
    <div class="acct-hero__bal${balance < 0 ? " is-neg" : ""}">${esc(whole)}<span class="acct-hero__cents">${esc(cents)}</span></div>
    ${hasTrends(info) ? `<div class="acct__trends" data-trend-id="${a.userAccountId}"></div>` : ""}
    <dl class="details">
      ${details
        .filter(([, v]) => v)
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
        .join("")}
    </dl>
  </section>`;
}

export function notFoundHtml(): string {
  return `
  <div class="acct-screen">
    <button type="button" class="btn btn--accent back-btn" data-action="back">${icons.arrowLeft}<span>Back to summary</span></button>
    <section class="card muted">That account isn't in your summary.</section>
  </div>`;
}

export function loadingBlock(kind: "chart" | "list"): string {
  return `<div class="skeleton skeleton--${kind}" aria-busy="true" aria-label="Loading"></div>`;
}

export function errorBlock(message: string): string {
  return `<p class="inline-error" role="alert">${icons.alert}<span>${esc(message)}</span></p>`;
}

// ---------- Chart ----------

/** One account's daily balances, oldest first. */
function balancePoints(data: NetWorthHistory, id: number): Point[] {
  const key = String(id);
  const points: Point[] = [];
  for (const row of data.spData?.histories ?? []) {
    const v = row.balances?.[key];
    if (typeof row.date === "string" && typeof v === "number" && Number.isFinite(v)) points.push({ date: row.date, value: v });
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function pointsFor(all: Point[], range: ChartRange): Point[] {
  if (range === "24h") return all.slice(-2);
  const last = all[all.length - 1];
  if (!last) return [];
  const from = dayNumber(last.date) - 90;
  return all.filter((p) => dayNumber(p.date) >= from);
}

/** Fill the chart card for `range` from the saved netWorthHistory. */
export function renderChart(card: HTMLElement, data: NetWorthHistory, id: number, range: ChartRange): void {
  for (const b of card.querySelectorAll<HTMLElement>("[data-range]")) b.setAttribute("aria-pressed", String(b.dataset.range === range));
  const body = card.querySelector<HTMLElement>("[data-role='chart-body']")!;
  const changeEl = card.querySelector<HTMLElement>("[data-role='chart-change']")!;

  const points = pointsFor(balancePoints(data, id), range);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) {
    changeEl.innerHTML = "";
    body.innerHTML = `<p class="muted chart-empty">Not enough balance history for this account yet.</p>`;
    return;
  }

  const diff = last.value - first.value;
  const pct = first.value > 0 ? ` (${signedPercent(diff / first.value)})` : "";
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  changeEl.innerHTML = `<span class="delta delta--${dir}">${esc(signedCents(diff))}${esc(pct)}</span>
    <span class="muted">${esc(shortDate(first.date))} – ${esc(shortDate(last.date))}</span>`;

  const note =
    range === "24h"
      ? `Your service saves one balance per day, so this compares the last two daily balances (${shortDate(first.date)} → ${shortDate(last.date)}). Includes deposits and withdrawals.`
      : "Daily balance, including deposits and withdrawals.";
  const rows = [...points]
    .reverse()
    .map((p) => `<tr><td>${esc(shortDate(p.date))}</td><td>${esc(moneyCents(p.value))}</td></tr>`)
    .join("");
  body.innerHTML = `
    <div class="chart"></div>
    <p class="chart-note muted small">${esc(note)}</p>
    <details class="chart-table">
      <summary class="small">Show values</summary>
      <div class="chart-table__scroll">
        <table><thead><tr><th scope="col">Date</th><th scope="col">Balance</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </details>`;
  mountLineChart(body.querySelector<HTMLElement>(".chart")!, points, `Balance, ${range}`);
}

// ---------- Transactions ----------

function accountTransactions(data: Transactions, id: number): Transaction[] {
  return (data.spData?.transactions ?? [])
    .filter((t) => t.userAccountId === id && !t.isDuplicate)
    .sort(
      (a, b) =>
        (b.transactionDate ?? "").localeCompare(a.transactionDate ?? "") ||
        (b.userTransactionId ?? 0) - (a.userTransactionId ?? 0),
    );
}

const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

// ---------- Transaction details (expanded row) ----------

const yesNo = (v: unknown): string => (v ? "Yes" : "No");
const titleCase = (s: string): string => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** How each known field is labelled and shown, in display order. Unknown fields follow, labelled from their names. */
const DETAIL_FIELDS: [key: keyof Transaction | string, label: string, show?: (v: unknown, t: Transaction) => string][] = [
  ["description", "Description"],
  ["originalDescription", "Original description"],
  ["transactionDate", "Date", (v) => mediumDate(String(v))],
  ["amount", "Amount", (v, t) => `${t.isCredit ? "+" : "\u2212"}${moneyCents(Math.abs(Number(v)))}`],
  ["isCredit", "Direction", (v) => (v ? "Money in" : "Money out")],
  ["originalAmount", "Original amount", (v) => moneyCents(Number(v))],
  ["status", "Status", (v) => titleCase(String(v))],
  ["categoryName", "Category label"],
  ["categoryType", "Category type", (v) => titleCase(String(v))],
  ["transactionType", "Transaction type", (v) => titleCase(String(v))],
  ["investmentType", "Investment type", (v) => titleCase(String(v))],
  ["price", "Price", (v) => moneyCents(Number(v))],
  ["quantity", "Quantity", (v) => qty.format(Number(v))],
  ["currency", "Currency"],
  ["accountName", "Account"],
  ["isCashIn", "Cash in", yesNo],
  ["isCashOut", "Cash out", yesNo],
  ["isIncome", "Income", yesNo],
  ["isSpending", "Spending", yesNo],
  ["isInterest", "Interest", yesNo],
  ["isDuplicate", "Duplicate", yesNo],
  ["userTransactionId", "Transaction ID"],
  ["userAccountId", "Account ID"],
  ["accountId", "Empower account ID"],
  ["merchantId", "Merchant ID"],
];

/** "originalAmount" -> "Original amount" */
const labelFromKey = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^is /i, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function showValue(v: unknown): string {
  if (typeof v === "boolean") return yesNo(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Every field of the transaction, labelled; the category comes from the category list. */
function detailsHtml(t: Transaction, index: CategoryIndex | null): string {
  const rows: [string, string][] = [];
  const known = new Set<string>();
  const record = t as Record<string, unknown>;
  for (const [key, label, show] of DETAIL_FIELDS) {
    known.add(key);
    const v = record[key];
    if (v === undefined || v === null || v === "") continue;
    rows.push([label, show ? show(v, t) : showValue(v)]);
    // The category (from the category list) and its group sit right after the amount details.
    if (key === "status") {
      const cat = index && typeof t.categoryId === "number" ? index.byId.get(t.categoryId) : undefined;
      if (typeof t.categoryId === "number") rows.push(["Category", cat?.name ? `${cat.name} (#${t.categoryId})` : `Unknown (#${t.categoryId})`]);
      if (index) rows.push(["Group", index.labelOf(index.isUncategorized(t) ? "UNCATEGORIZED" : (index.groupOf(t) ?? ""))]);
    }
  }
  known.add("categoryId");
  for (const [key, v] of Object.entries(record)) {
    if (known.has(key) || v === undefined || v === null || v === "") continue;
    rows.push([labelFromKey(key), showValue(v)]);
  }
  return `<dl class="txn-details">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

/** Key that identifies a row across re-renders. */
export const txnKey = (t: Transaction, fallback: string): string =>
  typeof t.userTransactionId === "number" ? String(t.userTransactionId) : fallback;

function transactionRow(t: Transaction, index: CategoryIndex | null, key: string, account?: string): string {
  const [, m, d] = (t.transactionDate ?? "").split("-").map(Number);
  const mon = m ? new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "short" }) : "";
  const amount = typeof t.amount === "number" ? Math.abs(t.amount) : null;
  const signed = amount === null ? "" : t.isCredit ? `+${moneyCents(amount)}` : `−${moneyCents(amount)}`;
  const trade =
    typeof t.quantity === "number" && t.quantity !== 0 && typeof t.price === "number"
      ? `${qty.format(Math.abs(t.quantity))} sh @ ${moneyCents(t.price)}`
      : "";
  const sub = [t.categoryName || t.transactionType, trade, account].filter(Boolean).map((x) => esc(x!)).join(" · ");
  const pending = t.status?.toLowerCase() === "pending" ? ` <span class="tag tag--warn">Pending</span>` : "";
  const panel = `txn-details-${esc(key)}`;
  // Click the row to show every field; only one row is open at a time (main.ts).
  return `
    <li class="txn" data-txn-key="${esc(key)}">
      <button type="button" class="txn__row" data-txn-toggle="${esc(key)}" aria-expanded="false" aria-controls="${panel}">
        <span class="txn__date" aria-label="${esc(t.transactionDate ? shortDate(t.transactionDate) : "")}"><span class="txn__mon">${esc(mon)}</span><span class="txn__day">${d ?? ""}</span></span>
        <span class="txn__text">
          <span class="txn__desc">${esc(t.description || t.originalDescription || "Transaction")}</span>
          <span class="txn__sub">${sub}${pending}</span>
        </span>
        <span class="txn__amt${t.isCredit ? " is-credit" : ""}">${esc(signed)}</span>
        <span class="txn__chev" aria-hidden="true">${icons.chevronDown}</span>
      </button>
      <div class="txn__details" id="${panel}" hidden>${detailsHtml(t, index)}</div>
    </li>`;
}

const count = new Intl.NumberFormat("en-US");

// ---------- Text search ----------

/** Identifier fields are left out of the search: "128" shouldn't match transaction 1128. */
const isIdField = (key: string): boolean => key === "id" || /Id$/.test(key);

const haystacks = new WeakMap<object, WeakMap<Transaction, string>>();
const NO_CATEGORIES = {};

/**
 * Everything a search can match for one transaction, lower-cased: every text and number
 * field (except IDs), plus how the row shows the date and amount, and the category's
 * name and group from the category list.
 */
function haystack(t: Transaction, index: CategoryIndex | null, categories: object | null): string {
  let cache = haystacks.get(categories ?? NO_CATEGORIES);
  if (!cache) haystacks.set(categories ?? NO_CATEGORIES, (cache = new WeakMap()));
  const hit = cache.get(t);
  if (hit !== undefined) return hit;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(t)) {
    if (isIdField(key)) continue;
    if (typeof value === "string") parts.push(value);
    else if (typeof value === "number" && Number.isFinite(value)) parts.push(String(value));
  }
  if (typeof t.amount === "number") {
    const amt = Math.abs(t.amount);
    parts.push(moneyCents(amt), amt.toFixed(2), `${t.isCredit ? "+" : "-"}${moneyCents(amt)}`);
  }
  if (t.transactionDate) parts.push(mediumDate(t.transactionDate), monthYear(t.transactionDate));
  const cat = index && typeof t.categoryId === "number" ? index.byId.get(t.categoryId) : undefined;
  if (cat?.name) parts.push(cat.name);
  if (index) parts.push(index.labelOf(index.isUncategorized(t) ? "UNCATEGORIZED" : (index.groupOf(t) ?? "")));
  const text = parts.join(" \u0000 ").toLowerCase();
  cache.set(t, text);
  return text;
}

export interface TransactionsView {
  /** The page actually shown (clamped). */
  page: number;
  /** The grouping actually applied (ALL while searching, or if the requested one isn't offered). */
  category: Selection;
}

/**
 * Fill the transactions card with one page, filtered by a grouping or a search.
 * `categories` is null while /data/categories is loading or if it failed: the
 * groupings are then left out of the filter list, but searching still works.
 */
export function renderTransactions(
  card: HTMLElement,
  data: Transactions,
  categories: TransactionCategory[] | null,
  id: number,
  page: number,
  filter: FilterState,
): TransactionsView {
  const account = accountTransactions(data, id);
  const box = card.querySelector<HTMLElement>("[data-role='txn-filter']")!;
  const index = categories ? indexCategories(categories) : null;
  if (index && categories) warnUnknownCategories(data.spData?.transactions ?? [], categories, index);

  const query = filter.query.trim();
  const sel: Selection = !query && index && index.isValid(filter.category) ? filter.category : ALL;
  let all = account;
  if (query) {
    // Every word must appear somewhere in the transaction.
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    all = account.filter((t) => {
      const text = haystack(t, index, categories);
      return terms.every((term) => text.includes(term));
    });
  } else if (index && sel !== ALL) {
    all = account.filter((t) => index.matches(t, sel));
  }

  const options: BoxOption[] = [
    { value: ALL, label: "All transactions", count: account.length },
    ...(index ? filterOptions(account, index) : []),
  ];
  updateFilterBox(box, options, { category: sel, query });
  const filterLabel = query ? `“${query}”` : index ? `“${index.labelOf(sel)}”` : "";

  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = data.spData?.startDate;
  const end = data.spData?.endDate;

  // Totals follow the filter.
  const countEl = card.querySelector<HTMLElement>("[data-role='txn-count']")!;
  countEl.textContent =
    query || sel !== ALL ? `${count.format(all.length)} of ${count.format(account.length)}` : count.format(all.length);
  countEl.hidden = account.length === 0;
  card.querySelector<HTMLElement>("[data-role='txn-range']")!.textContent =
    start && end ? `${mediumDate(start)} – ${mediumDate(end)}` : "Last 12 months";
  const totalsEl = card.querySelector<HTMLElement>("[data-role='txn-totals']")!;
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of all) {
    const amt = typeof t.amount === "number" ? Math.abs(t.amount) : 0;
    if (t.isCredit) moneyIn += amt;
    else moneyOut += amt;
  }
  totalsEl.innerHTML = `<span>In <strong class="is-credit">+${esc(moneyCents(moneyIn))}</strong></span><span>Out <strong>−${esc(moneyCents(moneyOut))}</strong></span>`;
  totalsEl.hidden = all.length === 0;

  const body = card.querySelector<HTMLElement>("[data-role='txn-body']")!;
  if (account.length === 0) {
    body.innerHTML = `<p class="muted txn-empty">No transactions for this account${start ? ` since ${esc(mediumDate(start))}` : " in the last 12 months"}.</p>`;
    return { page: 0, category: sel };
  }
  if (all.length === 0) {
    const message = query
      ? `No transactions for this account match ${filterLabel}.`
      : `No ${filterLabel} transactions for this account${start ? ` since ${mediumDate(start)}` : ""}.`;
    body.innerHTML = `<div class="txn-empty">
        <p class="muted">${esc(message)}</p>
        <button type="button" class="link-btn" data-action="clear-filter">Show all transactions</button>
      </div>`;
    return { page: 0, category: sel };
  }

  body.innerHTML = pagedTransactionsHtml(all, index, p);
  return { page: p, category: sel };
}

/**
 * One page (PAGE_SIZE) of `all`, grouped by month, with a pager when there's more than
 * one page. Rows expand to show every field (main.ts). `page` must already be clamped.
 * `accountOf` adds the account to each row (for lists that mix accounts).
 */
export function pagedTransactionsHtml(
  all: Transaction[],
  index: CategoryIndex | null,
  p: number,
  accountOf?: (t: Transaction) => string | undefined,
): string {
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const from = p * PAGE_SIZE;
  const shown = all.slice(from, from + PAGE_SIZE);
  const pager =
    pages > 1
      ? `<nav class="pager" aria-label="Transaction pages">
          <button type="button" class="pager__btn" data-page="${p - 1}" ${p === 0 ? "disabled" : ""}>${icons.chevronLeft}<span>Prev</span></button>
          <span class="pager__info" aria-live="polite">Page ${p + 1} of ${pages}<span class="pager__range"> · ${from + 1}–${from + shown.length} of ${all.length}</span></span>
          <button type="button" class="pager__btn" data-page="${p + 1}" ${p === pages - 1 ? "disabled" : ""}><span>Next</span>${icons.chevronRight}</button>
        </nav>`
      : "";
  // Group the page by month, since a year of transactions repeats month/day pairs.
  const groups: { month: string; rows: Transaction[] }[] = [];
  for (const t of shown) {
    const key = (t.transactionDate ?? "").slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === key) last.rows.push(t);
    else groups.push({ month: key, rows: [t] });
  }
  return (
    groups
      .map(
        (g) => `
      <h3 class="txn-month">${esc(g.month ? monthYear(`${g.month}-01`) : "Undated")}</h3>
      <ul class="txn-list">${g.rows.map((t) => transactionRow(t, index, txnKey(t, `${p}-${shown.indexOf(t)}`), accountOf?.(t))).join("")}</ul>`,
      )
      .join("") + pager
  );
}
