import type { Account, Summary } from "./types";
import { esc, money, moneyCents, moneyParts, percent, shortDate, signedMoney, signedPercent, timeAgo } from "./format";
import { icons } from "./icons";
import { EMERGENCY_FUND } from "./config";
import type { Change, TrendState } from "./trends";
import { availableBalance, availableCredit, lastRefreshedFor, needsReconnect, type Reconnect } from "./health";
import type { Dti } from "./dti";
import { duration, monthYear, type Payoff } from "./payoff";

// ---------- Categories (one per tile) and account groups ----------

export type Category = "cash" | "investments" | "credit" | "loans";

const CATEGORY_LABEL: Record<Category, string> = {
  cash: "Cash",
  investments: "Investment",
  credit: "Credit card",
  loans: "Loan",
};

export interface GroupInfo {
  label: string;
  icon: string;
  liability: boolean;
  order: number;
  /** Which tile shows this group. Null: no tile (unknown account types). */
  category: Category | null;
}

const GROUPS: Record<string, GroupInfo> = {
  BANK: { label: "Cash", icon: icons.bank, liability: false, order: 0, category: "cash" },
  INVESTMENT: { label: "Investments", icon: icons.growth, liability: false, order: 1, category: "investments" },
  RETIREMENT: { label: "Retirement", icon: icons.clock, liability: false, order: 2, category: "investments" },
  ESOP: { label: "Employee stock (ESOP)", icon: icons.growth, liability: false, order: 3, category: "investments" },
  ESPP: { label: "Employee stock (ESPP)", icon: icons.growth, liability: false, order: 4, category: "investments" },
  CREDIT_CARD: { label: "Credit cards", icon: icons.card, liability: true, order: 6, category: "credit" },
  LOAN: { label: "Loans", icon: icons.home, liability: true, order: 7, category: "loans" },
  MORTGAGE: { label: "Mortgage", icon: icons.home, liability: true, order: 8, category: "loans" },
};

/**
 * Group for an account. Uses accountTypeGroup, and falls back to productType
 * because some accounts (e.g. loans) arrive with accountTypeGroup: null and
 * only productType: "LOAN".
 */
export function groupInfo(account: Account): GroupInfo {
  const known =
    (account.accountTypeGroup ? GROUPS[account.accountTypeGroup] : undefined) ??
    (account.productType ? GROUPS[account.productType] : undefined);
  if (known) return known;
  const liability = account.isAsset === false;
  return { label: "Other", icon: icons.wallet, liability, order: liability ? 9 : 5, category: null };
}

// ---------- Pieces ----------

const num = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

function heroCard(s: Summary): string {
  const [whole, cents] = moneyParts(num(s.totalNetWorth));
  return `
  <section class="card hero" aria-label="Net worth">
    <div class="hero__label">Net worth</div>
    <div class="hero__value">${esc(whole)}<span class="hero__cents">${esc(cents)}</span></div>
    <div class="hero__split">
      <div><span>Assets</span><strong>${money(num(s.totalAsset))}</strong></div>
      <div><span>Liabilities</span><strong>${money(Math.abs(num(s.totalLiability)))}</strong></div>
      <div class="hero__dti" data-role="dti"><span>Debt-to-income</span><strong class="hero__pending" aria-label="Loading">…</strong></div>
      <div class="hero__dti" data-role="home"><span>Zestimate</span><strong class="hero__pending" aria-label="Loading">…</strong></div>
    </div>
    <div class="dti-panel" id="dti-panel" data-role="dti-panel" hidden></div>
    <div class="dti-panel home-panel" id="home-panel" data-role="home-panel" hidden></div>
  </section>`;
}

/** Value styling: `red` colors it as a debt; `minus` also shows it as negative. */
interface TileStyle {
  red?: boolean;
  minus?: boolean;
}

function tile(category: Category, label: string, icon: string, value: number, note: string, style: TileStyle = {}): string {
  return `
  <button type="button" class="card tile" data-category="${category}" aria-pressed="false" aria-controls="accounts">
    <span class="tile__icon">${icon}</span>
    <span class="tile__label">${esc(label)}</span>
    <span class="tile__value${style.red ? " is-neg" : ""}">${money(style.minus ? -Math.abs(value) : value)}</span>
    <span class="tile__note">${esc(note)}</span>
  </button>`;
}

function tiles(s: Summary): string {
  const assets = num(s.totalAsset);
  const liab = Math.abs(num(s.totalLiability));
  const cc = Math.abs(num(s.creditCardAmount));
  const loan = Math.abs(num(s.loanAmount));
  return `
  <section class="tiles" aria-label="Totals by category. Select one to see its accounts.">
    ${tile("cash", "Cash", icons.bank, num(s.bankAmount), `${percent(share(num(s.bankAmount), assets))} of assets`)}
    ${tile("investments", "Investments", icons.growth, num(s.investmentAmount), `${percent(share(num(s.investmentAmount), assets))} of assets`)}
    ${tile("credit", "Credit cards", icons.card, cc, liab > 0 ? `${percent(share(cc, liab))} of liabilities` : "No balance", { red: cc > 0, minus: cc > 0 })}
    ${tile("loans", "Loans", icons.home, loan, liab > 0 ? `${percent(share(loan, liab))} of liabilities` : "No balance", { red: loan > 0 })}
  </section>`;
}

export interface Row {
  account: Account;
  isEmpower: boolean;
}

// ---------- Sync freshness ----------

/** An account not synced by Empower for longer than this gets a warning icon. */
export const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

export const isSyncStale = (lastRefreshed: number | undefined): boolean =>
  typeof lastRefreshed === "number" && Date.now() - lastRefreshed > SYNC_STALE_MS;

/** "Synced 3 days ago" etc., with a warning icon in front when it's over 24 hours old. `text` is escaped here. */
export function syncedHtml(lastRefreshed: number | undefined, text: string): string {
  if (!isSyncStale(lastRefreshed)) return esc(text);
  const tip = "Not synced in over 24 hours";
  return `<span class="sync-stale" title="${tip}"><span class="sync-stale__icon" role="img" aria-label="${tip}">${icons.alert}</span>${esc(text)}</span>`;
}

/** Open accounts from the summary, Empower's own first. */
function openRows(s: Summary): Row[] {
  return [
    ...(s.empowerAccounts ?? []).map((account) => ({ account, isEmpower: true })),
    ...(s.aggregatedAccounts ?? []).map((account) => ({ account, isEmpower: false })),
  ].filter((r) => !r.account.closedDate);
}

/** The open account with this userAccountId, if any. */
export function findAccount(s: Summary, id: number): (Row & { info: GroupInfo }) | null {
  const row = openRows(s).find((r) => r.account.userAccountId === id);
  return row ? { ...row, info: groupInfo(row.account) } : null;
}

/** Accounts under a tile (cash, investments, credit cards, loans) open their own screen. */
export const opensDetail = (info: GroupInfo, account: Account): boolean =>
  info.category !== null && typeof account.userAccountId === "number";

/** Only investment-type accounts have performance trends and a balance chart. */
export const hasTrends = (info: GroupInfo): boolean => info.category === "investments";

/** Balance as the dashboard shows it: liabilities negative. */
export function signedBalance(account: Account, info: GroupInfo): number {
  const bal = typeof account.balance === "number" ? account.balance : 0;
  return info.liability ? -Math.abs(bal) : bal;
}

/** "~3.9 months" of necessary expenses covered by the emergency fund. */
function emergencyFundBadge(balance: number): string {
  const perMonth = EMERGENCY_FUND.monthlyExpenses;
  if (!(perMonth > 0)) return "";
  const months = Math.max(0, balance) / perMonth;
  const shown = months.toFixed(1).replace(/\.0$/, "");
  const unit = shown === "1" ? "month" : "months";
  const tip = `Emergency fund: ${moneyCents(balance)} ÷ ${money(perMonth)}/month in necessary expenses`;
  return `
    <div class="fund-badge" title="${esc(tip)}">
      <span class="fund-badge__label">Emergency fund</span>
      <span class="fund-badge__value">~${shown} ${unit}</span>
    </div>`;
}

/** "⚠ Reconnect in Empower" for an account Empower can't update until the user reconnects it. */
export function reconnectFlagHtml(r: Reconnect): string {
  const tip = `Empower can't update this account until you reconnect it in Empower.${r.label ? ` ${r.label}.` : ""}`;
  return `<span class="reconnect" title="${esc(tip)}"><span class="reconnect__icon" aria-hidden="true">${icons.alert}</span>Reconnect in Empower</span>`;
}

/**
 * The row's amount. Cash (checking/savings) accounts show only the available balance (what can be
 * spent now) when the accounts dataset has it. Credit cards show the balance owed with the
 * available credit under it.
 */
function balanceHtml(a: Account, info: GroupInfo, signed: number): string {
  if (info.category === "cash") {
    const avail = availableBalance(a.userAccountId);
    if (avail !== null) return `<div class="acct__bal${avail < 0 ? " is-neg" : ""}">${moneyCents(avail)}</div>`;
  }
  if (info.category === "credit") {
    const credit = availableCredit(a.userAccountId);
    if (credit !== null) {
      return `<div class="acct__bal${signed < 0 ? " is-neg" : ""}">${moneyCents(signed)}<span class="acct__bal-note">${esc(moneyCents(credit))} available</span></div>`;
    }
  }
  return `<div class="acct__bal${signed < 0 ? " is-neg" : ""}">${moneyCents(signed)}</div>`;
}

function accountRow({ account: a, isEmpower }: Row, info: GroupInfo): string {
  const bal = num(a.balance);
  const signed = info.liability ? -Math.abs(bal) : bal;
  const lastRefreshed = lastRefreshedFor(a.userAccountId, a.lastRefreshed);
  const synced = lastRefreshed ? syncedHtml(lastRefreshed, `Synced ${timeAgo(new Date(lastRefreshed))}`) : "";
  const reconnect = needsReconnect(a.userAccountId);
  const sub =
    [reconnect ? reconnectFlagHtml(reconnect) : "", a.firmName ? esc(a.firmName) : "", synced].filter(Boolean).join(" · ") +
    // Loans: "· Est. payoff Mar 2041", filled by applyPayoffs() once transactions are in.
    (info.category === "loans" ? `<span class="payoff" data-payoff-id="${a.userAccountId}"></span>` : "");
  const fund = a.userAccountId === EMERGENCY_FUND.userAccountId ? emergencyFundBadge(bal) : "";
  // Investment-type rows get a slot that applyTrends() fills in.
  const detail = opensDetail(info, a);
  const trend = detail && hasTrends(info) ? `<div class="acct__trends" data-trend-id="${a.userAccountId}"></div>` : "";
  const mods = [fund && "acct--fund", trend && "acct--trend", detail && "acct--link", reconnect && "acct--reconnect"]
    .filter(Boolean)
    .join(" ");
  const name = esc(a.name || a.originalName || "Account");
  // The whole row opens the account (main.ts); the link keeps it reachable by keyboard.
  const title = detail ? `<a class="acct__open" href="#/account/${a.userAccountId}">${name}</a>` : name;
  return `
  <li class="acct${mods ? ` ${mods}` : ""}"${detail ? ` data-account-id="${a.userAccountId}"` : ""}>
    <div class="acct__icon">${info.icon}</div>
    <div class="acct__text">
      <div class="acct__name">${title}${isEmpower ? ` <span class="tag">Empower</span>` : ""}</div>
      <div class="acct__sub">${sub}</div>
    </div>
    ${fund}${trend}
    ${balanceHtml(a, info, signed)}
    ${detail ? `<span class="acct__chev" aria-hidden="true">${icons.chevronRight}</span>` : ""}
  </li>`;
}

const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });
const accountName = (a: Account): string => a.name || a.originalName || "";

/** Institution A–Z (accounts without one last), then account name A–Z. */
function byInstitutionThenName(x: Row, y: Row): number {
  const fx = x.account.firmName?.trim() ?? "";
  const fy = y.account.firmName?.trim() ?? "";
  if (!fx !== !fy) return fx ? -1 : 1;
  return collator.compare(fx, fy) || collator.compare(accountName(x.account), accountName(y.account));
}

function accountsSection(s: Summary): string {
  const rows = openRows(s);

  const groups = new Map<string, { info: GroupInfo; rows: Row[] }>();
  for (const r of rows) {
    const info = groupInfo(r.account);
    const key = `${info.order}:${info.label}`;
    const g = groups.get(key) ?? { info, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }

  const cards = [...groups.values()]
    .sort((a, b) => a.info.order - b.info.order)
    .map(({ info, rows }) => {
      rows.sort(byInstitutionThenName);
      const total = rows.reduce((t, r) => t + Math.abs(num(r.account.balance)), 0);
      return `
      <section class="card group" data-category="${info.category ?? ""}" data-count="${rows.length}" hidden>
        <header class="group__head">
          <h3>${esc(info.label)} <span class="count">${rows.length}</span></h3>
          <strong class="${info.liability ? "is-neg" : ""}">${money(info.liability ? -total : total)}</strong>
        </header>
        <ul class="acct-list">${rows.map((r) => accountRow(r, info)).join("")}</ul>
      </section>`;
    })
    .join("");

  return `
  <section class="accounts" id="accounts" aria-labelledby="acct-title" hidden>
    <h2 id="acct-title" class="section-title"><span data-role="title">Accounts</span> <span class="count" data-role="count"></span></h2>
    <p class="card muted empty" data-role="empty" hidden></p>
    <div class="groups">${cards}</div>
  </section>`;
}

// ---------- Public ----------

export function dashboardHtml(s: Summary): string {
  return `
  <div class="grid">
    ${heroCard(s)}
    ${tiles(s)}
    ${accountsSection(s)}
  </div>`;
}

/**
 * Highlight the selected tile and show only its account panels.
 * `null` hides every panel. Call after each render.
 */
export function applySelection(container: ParentNode, selected: Category | null): void {
  for (const t of container.querySelectorAll<HTMLElement>(".tile[data-category]")) {
    const on = t.dataset.category === selected;
    t.classList.toggle("is-selected", on);
    t.setAttribute("aria-pressed", String(on));
  }

  const section = container.querySelector<HTMLElement>("#accounts");
  if (!section) return;
  section.hidden = selected === null;
  if (selected === null) return;

  let count = 0;
  for (const g of section.querySelectorAll<HTMLElement>(".group")) {
    const on = g.dataset.category === selected;
    g.hidden = !on;
    if (on) count += Number(g.dataset.count) || 0;
  }

  const label = CATEGORY_LABEL[selected];
  section.querySelector("[data-role='title']")!.textContent = `${label} accounts`;
  const countEl = section.querySelector<HTMLElement>("[data-role='count']")!;
  countEl.textContent = String(count);
  countEl.hidden = count === 0;
  const empty = section.querySelector<HTMLElement>("[data-role='empty']")!;
  empty.textContent = `No open ${label.toLowerCase()} accounts.`;
  empty.hidden = count > 0;
}

// ---------- Trends (investment rows) ----------

const DAY_TIP = "Market gain/loss over the last trading day, excluding deposits and withdrawals.";

function trendPill(label: string, c: Change | null | undefined, tip: string): string {
  if (!c) {
    return `<span class="trend trend--none" title="${esc(tip)}"><span class="trend__label">${label}</span><span class="trend__value">—</span></span>`;
  }
  const dir = c.value > 0 ? "up" : c.value < 0 ? "down" : "flat";
  const pct = c.fraction === null ? "" : `<span class="trend__pct">${esc(signedPercent(c.fraction))}</span>`;
  return `
    <span class="trend trend--${dir}" title="${esc(tip)}">
      <span class="trend__label">${label}</span>
      <span class="trend__value">${esc(signedMoney(c.value))}</span>${pct}
    </span>`;
}

const loadingPill = (label: string): string =>
  `<span class="trend is-loading" aria-hidden="true"><span class="trend__label">${label}</span><span class="trend__value"></span></span>`;

// ---------- Loan payoff estimates (filled once transactions are loaded) ----------

const pctRate = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function payoffDetailHtml(p: Payoff | undefined, problem: string | null): string {
  if (!p) return problem ? `<span class="muted">Unavailable</span><small class="dd-sub">${esc(problem)}</small>` : `<span class="muted">Calculating…</span>`;
  const rate = (pRate: number, source: "settings" | "estimated") =>
    `${pctRate.format(pRate)}% ${source === "settings" ? "(from Settings)" : "(estimated from balance history)"}`;
  switch (p.status) {
    case "ok":
      return `${esc(monthYear(p.date))} <span class="muted">(${esc(duration(p.months))})</span>
        <small class="dd-sub">${esc(moneyCents(p.payment))}/mo${p.paymentKind === "principal-interest" ? " principal &amp; interest" : ""} at ${esc(rate(p.annualRate, p.rateSource))}</small>`;
    case "paid":
      return "Paid off";
    case "no-payments":
      return `<span class="muted">Not enough payment history</span>
        <small class="dd-sub">Needs payments into this account in at least 2 of the last 3 months.</small>`;
    case "need-rate":
      return `<a class="link" href="#/settings">Add the interest rate</a> to estimate
        <small class="dd-sub">${esc(moneyCents(p.payment))}/mo paid; the rate couldn't be worked out from the balance history.</small>`;
    case "never":
      return `<span class="warn-text">Payment doesn't cover the interest</span>
        <small class="dd-sub">${esc(moneyCents(p.payment))}/mo${p.paymentKind === "principal-interest" ? " principal &amp; interest" : ""} at ${esc(rate(p.annualRate, p.rateSource))}</small>`;
  }
}

/**
 * Fill loan payoff slots: "· Est. payoff Mar 2041" on Summary rows, and the "Estimated payoff"
 * detail on a loan's account screen. `payoffs` is null while the data is loading.
 */
export function applyPayoffs(container: ParentNode, payoffs: Map<number, Payoff> | null, problem: string | null): void {
  for (const el of container.querySelectorAll<HTMLElement>("[data-payoff-id]")) {
    const p = payoffs?.get(Number(el.dataset.payoffId));
    el.innerHTML =
      p?.status === "ok"
        ? ` · <span class="nowrap">Est. payoff ${esc(monthYear(p.date))}</span>`
        : p?.status === "never"
          ? ` · <span class="warn-text nowrap">Payment doesn't cover interest</span>`
          : "";
  }
  for (const el of container.querySelectorAll<HTMLElement>("[data-payoff-detail]")) {
    el.innerHTML = payoffDetailHtml(payoffs?.get(Number(el.dataset.payoffDetail)), payoffs ? null : problem);
  }
}

// ---------- Debt-to-income (filled after the summary renders) ----------

export type DtiState =
  | { kind: "loading" }
  | { kind: "no-income" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dti: Dti };

const pct1 = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "2026-08", "2026-10" -> "Aug – Oct 2026" */
function monthSpan(months: string[]): string {
  const label = (ym: string, year: boolean) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString("en-US", year ? { month: "short", year: "numeric" } : { month: "short" });
  };
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return "";
  if (first === last) return label(first, true);
  return `${label(first, first.slice(0, 4) !== last.slice(0, 4))} – ${label(last, true)}`;
}

function dtiPanelHtml(d: Dti): string {
  const span = monthSpan(d.months);
  const sources = d.sources.length
    ? `<ul class="dti-panel__sources">${d.sources
        .map(
          (s) => `<li><span>${esc(s.name)}<small>${s.count} payment${s.count === 1 ? "" : "s"}</small></span><strong>${moneyCents(s.monthly)}/mo</strong></li>`,
        )
        .join("")}</ul>`
    : `<p class="dti-panel__empty">No mortgage or loan payments found in ${esc(span)}.</p>`;
  return `
    <dl class="dti-panel__rows">
      <div><dt>Monthly debt payments</dt><dd>${moneyCents(d.monthlyDebt)}</dd></div>
      <div><dt>Monthly income</dt><dd>${d.monthlyIncome !== null ? moneyCents(d.monthlyIncome) : "—"}
        ${d.monthlyIncome !== null ? `<small>${money(d.monthlyIncome * 12)} a year ÷ 12</small>` : ""}</dd></div>
      <div><dt>Averaged over</dt><dd>${esc(span)}</dd></div>
    </dl>
    ${sources}
    <p class="dti-panel__note">Counts payments into your linked loan, mortgage and credit card accounts, plus payments
      from other accounts categorized as a mortgage, loan or credit card payment. Credit card payments are what you
      actually paid, often the full statement, so this can be higher than a lender's figure, which uses the minimum
      payment. Many lenders look for 36% or less, and 43% is a common upper limit for a mortgage. Income is from
      Settings → Household details.</p>`;
}

/** Fill the Net worth card's debt-to-income slot and its breakdown. Call after each render and state change. */
export function applyDti(container: ParentNode, state: DtiState, open: boolean): void {
  const slot = container.querySelector<HTMLElement>("[data-role='dti']");
  const panel = container.querySelector<HTMLElement>("[data-role='dti-panel']");
  if (!slot || !panel) return;
  const label = `<span>Debt-to-income</span>`;
  if (state.kind === "loading") {
    slot.innerHTML = `${label}<strong class="hero__pending" aria-label="Loading">…</strong>`;
  } else if (state.kind === "no-income") {
    slot.innerHTML = `${label}<a class="hero__link" href="#/settings">Add income</a>`;
  } else if (state.kind === "error") {
    slot.innerHTML = `${label}<strong title="${esc(state.message)}" aria-label="Unavailable: ${esc(state.message)}">—</strong>`;
  } else {
    const d = state.dti;
    const value = d.ratio !== null ? pct1.format(d.ratio) : "—";
    slot.innerHTML = `${label}<button type="button" class="hero__dti-btn" data-action="toggle-dti" aria-expanded="${open}"
      aria-controls="dti-panel" title="How this is calculated"><strong>${esc(value)}</strong>${icons.chevronDown}</button>`;
    panel.innerHTML = dtiPanelHtml(d);
  }
  const showPanel = open && state.kind === "ready";
  panel.hidden = !showPanel;
  slot.classList.toggle("is-open", showPanel);
}

/** Fill each investment row's trend slot from the current state. Call after each render and state change. */
export function applyTrends(container: ParentNode, state: TrendState): void {
  for (const slot of container.querySelectorAll<HTMLElement>("[data-trend-id]")) {
    const id = Number(slot.dataset.trendId);
    switch (state.status) {
      case "idle":
        slot.innerHTML = "";
        slot.removeAttribute("aria-busy");
        break;
      case "loading":
        slot.innerHTML = loadingPill("24h") + loadingPill("90d");
        slot.setAttribute("aria-busy", "true");
        break;
      case "error":
        slot.innerHTML =
          trendPill("24h", null, `Trend unavailable: ${state.message}`) +
          trendPill("90d", null, `Trend unavailable: ${state.message}`);
        slot.removeAttribute("aria-busy");
        break;
      case "ready": {
        const t = state.byId.get(id);
        const span = state.from && state.to ? `${shortDate(state.from)} – ${shortDate(state.to)}` : "over the last 90 days";
        const none = "No performance data for this account.";
        const rangeTip = t?.range ? `Market gain/loss ${span}, excluding deposits and withdrawals.` : none;
        slot.innerHTML = trendPill("24h", t?.day, t?.day ? DAY_TIP : none) + trendPill("90d", t?.range, rangeTip);
        slot.removeAttribute("aria-busy");
        break;
      }
    }
  }
}

export function loadingHtml(): string {
  const block = (cls: string) => `<div class="card skeleton ${cls}"></div>`;
  return `
  <div class="grid" aria-busy="true" aria-label="Loading">
    ${block("hero")}
    <div class="tiles">${block("tile")}${block("tile")}${block("tile")}${block("tile")}</div>
  </div>`;
}

/** Prompt for the API key. Optional `problem` explains why it's being asked again. */
export function keyFormHtml(problem?: string): string {
  return `
  <section class="card connect">
    <div class="error__icon">${icons.key}</div>
    <h2>Connect to your service</h2>
    <p class="muted">Enter an API key from the service's <code>data/api-keys.txt</code>. It's kept only in this browser and sent only to your service.</p>
    ${problem ? `<p class="form-error" role="alert">${icons.alert}<span>${esc(problem)}</span></p>` : ""}
    <form class="connect__form" data-form="api-key">
      <label class="field">
        <span>API key</span>
        <input type="password" name="apiKey" required autocomplete="off" autocapitalize="off" spellcheck="false" />
      </label>
      <label class="check"><input type="checkbox" name="remember" checked /> <span>Remember on this device</span></label>
      <button class="btn btn--accent" type="submit">${icons.key}<span>Connect</span></button>
    </form>
  </section>`;
}

export function errorHtml(title: string, body: string): string {
  return `
  <section class="card error" role="alert">
    <div class="error__icon">${icons.plug}</div>
    <h2>${esc(title)}</h2>
    <div class="error__body">${body}</div>
    <button class="btn btn--accent" data-action="reload">${icons.refresh}<span>Try again</span></button>
  </section>`;
}
