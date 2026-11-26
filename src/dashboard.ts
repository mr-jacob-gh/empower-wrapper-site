import type { Account, Summary } from "./types";
import { esc, money, moneyCents, moneyParts, percent, shortDate, signedMoney, signedPercent, timeAgo } from "./format";
import { icons } from "./icons";
import { EMERGENCY_FUND } from "./config";
import type { Change, TrendState } from "./trends";

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
    </div>
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

function accountRow({ account: a, isEmpower }: Row, info: GroupInfo): string {
  const bal = num(a.balance);
  const signed = info.liability ? -Math.abs(bal) : bal;
  const synced = a.lastRefreshed ? `Synced ${timeAgo(new Date(a.lastRefreshed))}` : "";
  const sub = [a.firmName, synced].filter(Boolean).map(esc).join(" · ");
  const fund = a.userAccountId === EMERGENCY_FUND.userAccountId ? emergencyFundBadge(bal) : "";
  // Investment-type rows get a slot that applyTrends() fills in.
  const detail = opensDetail(info, a);
  const trend = detail && hasTrends(info) ? `<div class="acct__trends" data-trend-id="${a.userAccountId}"></div>` : "";
  const mods = [fund && "acct--fund", trend && "acct--trend", detail && "acct--link"].filter(Boolean).join(" ");
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
    <div class="acct__bal${signed < 0 ? " is-neg" : ""}">${moneyCents(signed)}</div>
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
