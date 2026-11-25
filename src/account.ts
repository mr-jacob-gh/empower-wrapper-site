// The account screen: details, balance trend chart (24h / 90d) and transactions
// (10 per page). Data comes from saved files only (netWorthHistory, transactions).

import type { NetWorthHistory, Transaction, Transactions } from "./types";
import { dateTime, esc, moneyCents, moneyParts, shortDate, signedPercent, timeAgo } from "./format";
import { icons } from "./icons";
import type { GroupInfo, Row } from "./dashboard";
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
    </section>
    <section class="card txn-card" aria-labelledby="txn-title">
      <header class="card-head">
        <div>
          <h2 id="txn-title" class="card-head__title">Transactions <span class="count" data-role="txn-count" hidden></span></h2>
          <div class="muted small" data-role="txn-range"></div>
        </div>
      </header>
      <div data-role="txn-body">${loadingBlock("list")}</div>
    </section>
  </div>`;
}

/** Name, balance, 24h/90d pills (filled by applyTrends) and details. */
export function heroHtml({ account: a, isEmpower, info }: Found): string {
  const [whole, cents] = moneyParts(typeof a.balance === "number" ? a.balance : 0);
  const synced = a.lastRefreshed ? new Date(a.lastRefreshed) : null;
  const details: [string, string][] = [
    ["Institution", a.firmName ?? ""],
    ["Type", info.label],
    ["Account holder", a.accountHolder ?? ""],
    ["Last synced", synced ? `${dateTime(synced)} (${timeAgo(synced)})` : ""],
  ];
  return `
  <section class="card acct-hero" data-role="hero">
    <div class="acct-hero__top">
      <div class="acct__icon">${info.icon}</div>
      <div class="acct-hero__titles">
        <h1 class="acct-hero__name">${esc(a.name || a.originalName || "Account")}${isEmpower ? ` <span class="tag">Empower</span>` : ""}</h1>
        <div class="muted small">${[a.firmName, info.label].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
    </div>
    <div class="acct-hero__bal">${esc(whole)}<span class="acct-hero__cents">${esc(cents)}</span></div>
    <div class="acct__trends" data-trend-id="${a.userAccountId}"></div>
    <dl class="details">
      ${details
        .filter(([, v]) => v)
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
        .join("")}
    </dl>
  </section>`;
}

export function notFoundHtml(): string {
  return `
  <div class="acct-screen">
    <button type="button" class="btn btn--accent back-btn" data-action="back">${icons.arrowLeft}<span>Back to summary</span></button>
    <section class="card muted">That account isn't in your summary, or it isn't an investment account.</section>
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

function transactionRow(t: Transaction): string {
  const [, m, d] = (t.transactionDate ?? "").split("-").map(Number);
  const mon = m ? new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "short" }) : "";
  const amount = typeof t.amount === "number" ? Math.abs(t.amount) : null;
  const signed = amount === null ? "" : t.isCredit ? `+${moneyCents(amount)}` : `−${moneyCents(amount)}`;
  const trade =
    typeof t.quantity === "number" && t.quantity !== 0 && typeof t.price === "number"
      ? `${qty.format(Math.abs(t.quantity))} sh @ ${moneyCents(t.price)}`
      : "";
  const sub = [t.categoryName || t.transactionType, trade].filter(Boolean).map(esc).join(" · ");
  const pending = t.status?.toLowerCase() === "pending" ? ` <span class="tag tag--warn">Pending</span>` : "";
  return `
    <li class="txn">
      <div class="txn__date" aria-label="${esc(t.transactionDate ? shortDate(t.transactionDate) : "")}"><span class="txn__mon">${esc(mon)}</span><span class="txn__day">${d ?? ""}</span></div>
      <div class="txn__text">
        <div class="txn__desc">${esc(t.description || t.originalDescription || "Transaction")}</div>
        <div class="txn__sub">${sub}${pending}</div>
      </div>
      <div class="txn__amt${t.isCredit ? " is-credit" : ""}">${esc(signed)}</div>
    </li>`;
}

/** Fill the transactions card with one page. Returns the page actually shown (clamped). */
export function renderTransactions(card: HTMLElement, data: Transactions, id: number, page: number): number {
  const all = accountTransactions(data, id);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = data.spData?.startDate;
  const end = data.spData?.endDate;

  const count = card.querySelector<HTMLElement>("[data-role='txn-count']")!;
  count.textContent = String(all.length);
  count.hidden = all.length === 0;
  card.querySelector<HTMLElement>("[data-role='txn-range']")!.textContent =
    start && end ? `${shortDate(start)} – ${shortDate(end)} (month to date)` : "Month to date";

  const body = card.querySelector<HTMLElement>("[data-role='txn-body']")!;
  if (all.length === 0) {
    body.innerHTML = `<p class="muted txn-empty">No transactions for this account${start ? ` since ${esc(shortDate(start))}` : " this month"}.</p>`;
    return 0;
  }

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
  body.innerHTML = `<ul class="txn-list">${shown.map(transactionRow).join("")}</ul>${pager}`;
  return p;
}
