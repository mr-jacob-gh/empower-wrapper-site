import "./styles.css";
import { API_BASE, ApiError, getCategories, getNetWorthHistory, getSummary, getTransactions } from "./api";
import { clearApiKey, getApiKey, setApiKey } from "./auth";
import {
  applySelection,
  applyTrends,
  dashboardHtml,
  errorHtml,
  findAccount,
  hasTrends,
  keyFormHtml,
  loadingHtml,
  opensDetail,
  type Category,
} from "./dashboard";
import {
  accountScreenHtml,
  errorBlock,
  heroHtml,
  notFoundHtml,
  PAGE_SIZE,
  pagedTransactionsHtml,
  renderChart,
  renderTransactions,
  type ChartRange,
} from "./account";
import { cached } from "./cache";
import { detectSubscriptions, isSubSort, renderSubscriptions, subscriptionsShellHtml, type SubSort } from "./subscriptions";
import {
  clearRules,
  dropLegacyRules,
  legacyNameKey,
  legacyRules,
  loadRules,
  ruleById,
  rulesLoaded,
  setCategory,
  setRule,
} from "./rules";
import {
  isRangeKey,
  isSliceKey,
  renderSpendingChart,
  SLICES,
  sliceResolver,
  spendingBreakdown,
  spendingListHeadHtml,
  spendingShellHtml,
  type RangeKey,
  type SliceKey,
} from "./spending";
import { indexCategories } from "./categories";
import { ALL, type Selection } from "./categories";
import { mountFilterBox, type FilterState } from "./filterbox";
import { dateTime, esc, timeAgo } from "./format";
import { icons } from "./icons";
import { clearTrends, ensureTrends, trendState } from "./trends";
import type { Summary, Transaction } from "./types";

/** The service saves every 15 minutes; flag data older than this as stale. */
const STALE_AFTER_MS = 30 * 60 * 1000;
/** Re-read the saved file this often while the tab is visible. */
const POLL_MS = 5 * 60 * 1000;
const APP_TITLE = document.title;

const root = document.querySelector<HTMLDivElement>("#app")!;

root.innerHTML = `
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="brand__mark">${icons.logo}</span><span>Empower</span></div>
      <nav class="nav" aria-label="Main">
        <a class="nav__item is-active" href="#" data-nav="dashboard" aria-current="page">${icons.dashboard}<span>Summary</span></a>
        <a class="nav__item" href="#/spending" data-nav="spending">${icons.pie}<span>Spending</span></a>
        <a class="nav__item" href="#/subscriptions" data-nav="subscriptions">${icons.repeat}<span>Subscriptions</span></a>
      </nav>
      <div class="sidebar__foot">
        <div class="muted small">Service</div>
        <code class="small">${esc(API_BASE)}</code>
        <button class="link-btn small" data-action="forget-key">${icons.logout}<span>Forget API key</span></button>
      </div>
    </aside>

    <header class="topbar">
      <div class="brand"><span class="brand__mark">${icons.logo}</span><span>Empower</span></div>
      <nav class="topnav" aria-label="Main">
        <a class="topnav__item is-active" href="#" data-nav="dashboard" aria-current="page">Summary</a>
        <a class="topnav__item" href="#/spending" data-nav="spending">Spending</a>
        <a class="topnav__item" href="#/subscriptions" data-nav="subscriptions">Subscriptions</a>
      </nav>
      <div class="topbar__actions">
        <button class="icon-btn" data-action="forget-key" aria-label="Forget API key" title="Forget API key">${icons.logout}</button>
        <button class="icon-btn" data-action="reload" aria-label="Refresh">${icons.refresh}</button>
      </div>
    </header>

    <main class="main">
      <div class="stage">
        <div class="screen" data-screen="dashboard">
          <div class="page-head page-head--inline">
            <h1>Summary</h1>
            <div id="freshness" class="freshness"></div>
            <button class="btn btn--accent page-head__btn" data-action="reload">${icons.refresh}<span>Refresh</span></button>
          </div>
          <div id="content"></div>
        </div>
        <div class="screen" data-screen="account" id="account" hidden></div>
        <div class="screen" data-screen="subscriptions" id="subscriptions" hidden></div>
        <div class="screen" data-screen="spending" id="spending" hidden></div>
      </div>
    </main>
  </div>
`;

const stage = root.querySelector<HTMLDivElement>(".stage")!;
const dashboardScreen = root.querySelector<HTMLDivElement>("[data-screen='dashboard']")!;
const accountScreen = root.querySelector<HTMLDivElement>("#account")!;
const subsScreen = root.querySelector<HTMLDivElement>("#subscriptions")!;
const spendScreen = root.querySelector<HTMLDivElement>("#spending")!;
const content = root.querySelector<HTMLDivElement>("#content")!;
const freshness = root.querySelector<HTMLDivElement>("#freshness")!;

let savedAt: Date | null = null;
let summary: Summary | null = null;
/** Tile whose accounts are showing; kept across re-renders. */
let selected: Category | null = null;
let inFlight: AbortController | null = null;

// Saved datasets for the account screen, kept in this tab's memory only.
const balanceHistory = cached(() => getNetWorthHistory(), POLL_MS);
const transactions = cached(() => getTransactions(), POLL_MS);
/** The category list changes rarely: fetched once per page load. */
const categories = cached(() => getCategories(), Number.POSITIVE_INFINITY);

function clearData(): void {
  summary = null;
  clearTrends();
  balanceHistory.clear();
  transactions.clear();
  categories.clear();
  clearRules();
}

function renderFreshness(): void {
  if (!savedAt) {
    freshness.innerHTML = "";
    return;
  }
  const stale = Date.now() - savedAt.getTime() > STALE_AFTER_MS;
  freshness.innerHTML = stale
    ? `<span class="chip chip--warn" title="${esc(dateTime(savedAt))}">${icons.alert}<span>Stale · last fetched ${esc(timeAgo(savedAt))}</span></span>`
    : `<span class="chip" title="${esc(dateTime(savedAt))}"><i class="dot"></i><span>Last fetched ${esc(timeAgo(savedAt))}</span></span>`;
}

function showKeyForm(problem?: string): void {
  inFlight?.abort();
  clearData();
  savedAt = null;
  renderFreshness();
  leaveToDashboardNow();
  content.innerHTML = keyFormHtml(problem);
  content.querySelector<HTMLInputElement>("input[name='apiKey']")?.focus();
}

/** For key problems from any request: ask for the key again. Returns true if handled. */
function handleKeyError(err: unknown): boolean {
  if (err instanceof ApiError && err.kind === "unauthorized") {
    clearApiKey();
    showKeyForm("The service rejected that key. Check it and try again.");
    return true;
  }
  if (err instanceof ApiError && err.kind === "no-key") {
    showKeyForm();
    return true;
  }
  return false;
}

async function load(showSkeleton: boolean): Promise<void> {
  if (!getApiKey()) {
    // Don't wipe a half-typed key on refresh/poll.
    if (!content.querySelector("[data-form='api-key']")) showKeyForm();
    return;
  }
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  root.classList.add("is-loading");
  if (showSkeleton) content.innerHTML = loadingHtml();

  try {
    const result = await getSummary(ctrl.signal);
    savedAt = result.savedAt;
    summary = result.data;
    content.innerHTML = dashboardHtml(result.data);
    applySelection(content, selected);
    renderTrends();
    if (selected === "investments") loadTrends(false);
    applyRoute(false);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    savedAt = null;
    if (err instanceof ApiError && err.kind === "unauthorized") {
      clearApiKey();
      clearData();
      leaveToDashboardNow();
      content.innerHTML = keyFormHtml("The service rejected that key. Check it and try again.");
    } else {
      // Errors are shown on the dashboard screen.
      leaveToDashboardNow();
      content.innerHTML = describeError(err);
    }
  } finally {
    if (inFlight === ctrl) {
      inFlight = null;
      root.classList.remove("is-loading");
      renderFreshness();
    }
  }
}

// ---------- Investment trends (24h / 90d per account) ----------

function renderTrends(): void {
  applyTrends(content, trendState());
  applyTrends(accountScreen, trendState());
}

/**
 * Load trends from the saved performance file (no Empower call).
 * Reuses what's in memory for 5 minutes unless `force`.
 */
function loadTrends(force: boolean): void {
  ensureTrends(force, renderTrends).catch(handleKeyError);
}

// ---------- Account screen ----------

type ScreenName = "dashboard" | "account" | "subscriptions" | "spending";
let current: ScreenName = "dashboard";
/** What the account screen shows; kept across re-renders of the same account. */
let accountUi: {
  id: number;
  range: ChartRange;
  page: number;
  category: Selection;
  query: string;
  /** The expanded transaction row, if any (one at a time). */
  openTxn: string | null;
} = { id: -1, range: "90d", page: 0, category: ALL, query: "", openTxn: null };
let dashboardScroll = 0;

// Account URLs: #/account/<id>, optionally ?category=<INCOME|EXPENSE|TRANSFER|UNCATEGORIZED> or ?q=<search>.
const ROUTE = /^#\/account\/(\d+)(?:\?(.*))?$/;

function routeAccountId(): number | null {
  const m = ROUTE.exec(location.hash);
  return m ? Number(m[1]) : null;
}

function routeFilter(): FilterState {
  const params = new URLSearchParams(ROUTE.exec(location.hash)?.[2] ?? "");
  const query = (params.get("q") ?? "").trim();
  return { category: query ? ALL : params.get("category") || ALL, query };
}

/** Keep the transactions filter in the URL (replacing, not adding, a history entry). */
function syncFilterToUrl(): void {
  const id = routeAccountId();
  if (id === null) return;
  const params = new URLSearchParams();
  if (accountUi.query) params.set("q", accountUi.query);
  else if (accountUi.category !== ALL) params.set("category", accountUi.category);
  const qs = params.toString();
  const hash = `#/account/${id}${qs ? `?${qs}` : ""}`;
  if (hash !== location.hash) {
    history.replaceState(history.state, "", hash);
    appliedHash = location.hash;
  }
}

/** The URL fragment applyRoute() last acted on. */
let appliedHash = location.hash;

// Subscriptions URL: #/subscriptions, optionally ?sort=next (default: name).
const SUBS_ROUTE = /^#\/subscriptions\/?(?:\?(.*))?$/;
const isSubscriptionsRoute = (): boolean => SUBS_ROUTE.test(location.hash);

function routeSubSort(): SubSort {
  const sort = new URLSearchParams(SUBS_ROUTE.exec(location.hash)?.[1] ?? "").get("sort");
  return isSubSort(sort) ? sort : "name";
}

/** Highlight the nav item for the current page (accounts belong to the dashboard). */
// Spending URL: #/spending, optionally ?range=<week|month|year|ytd>&slice=<restaurants|...>.
const SPEND_ROUTE = /^#\/spending\/?(?:\?(.*))?$/;
const isSpendingRoute = (): boolean => SPEND_ROUTE.test(location.hash);

function routeSpending(): { range: RangeKey; slice: SliceKey | null } {
  const params = new URLSearchParams(SPEND_ROUTE.exec(location.hash)?.[1] ?? "");
  const range = params.get("range");
  const slice = params.get("slice");
  return { range: isRangeKey(range) ? range : "month", slice: isSliceKey(slice) ? slice : null };
}

function setSpendingUrl(range: RangeKey, slice: SliceKey | null): void {
  const params = new URLSearchParams();
  if (range !== "month") params.set("range", range);
  if (slice) params.set("slice", slice);
  const qs = params.toString();
  history.replaceState(history.state, "", `#/spending${qs ? `?${qs}` : ""}`);
  appliedHash = location.hash;
}

function updateNav(): void {
  const page = isSubscriptionsRoute() ? "subscriptions" : isSpendingRoute() ? "spending" : "dashboard";
  for (const a of root.querySelectorAll<HTMLElement>("[data-nav]")) {
    const on = a.dataset.nav === page;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/** Show whatever the URL asks for. */
function applyRoute(animate: boolean): void {
  appliedHash = location.hash;
  updateNav();
  if (isSubscriptionsRoute()) {
    renderSubscriptionsScreen();
    if (current !== "subscriptions") void show("subscriptions", animate);
    return;
  }
  if (isSpendingRoute()) {
    renderSpendingScreen();
    if (current !== "spending") void show("spending", animate);
    return;
  }
  const id = routeAccountId();
  if (id !== null) {
    if (!summary) return; // load() calls this again once the summary is in
    const fresh = accountUi.id !== id || current !== "account";
    renderAccount(id, fresh);
    if (current !== "account") void show("account", animate);
  } else if (current !== "dashboard") {
    void show("dashboard", animate);
  }
}

/**
 * Build (or, for a refresh of the same account, update) the account screen.
 * `fresh`: a newly opened account, so rebuild everything and reset the page.
 */
function renderAccount(id: number, fresh: boolean): void {
  const found = summary ? findAccount(summary, id) : null;
  if (!found || !opensDetail(found.info, found.account)) {
    accountUi = { id, range: "90d", page: 0, category: ALL, query: "", openTxn: null };
    accountScreen.innerHTML = notFoundHtml();
    document.title = APP_TITLE;
    return;
  }
  document.title = `${found.account.name || found.account.originalName || "Account"} · ${APP_TITLE}`;
  const withTrends = hasTrends(found.info);

  // Keep the account's tile selected so Back lands on its list (also for deep links).
  if (found.info.category && selected !== found.info.category) {
    selected = found.info.category;
    applySelection(content, selected);
  }

  const hero = accountScreen.querySelector<HTMLElement>("[data-role='hero']");
  // The URL holds the transactions filter (so it survives a reload and back/forward).
  const filter = routeFilter();
  if (accountUi.id === id && (accountUi.category !== filter.category || accountUi.query !== filter.query)) {
    accountUi.category = filter.category;
    accountUi.query = filter.query;
    accountUi.page = 0;
  }
  if (fresh || !hero || accountUi.id !== id) {
    if (accountUi.id !== id) accountUi = { id, range: "90d", page: 0, ...filter, openTxn: null };
    accountScreen.innerHTML = accountScreenHtml(found, accountUi.range);
    const box = accountScreen.querySelector<HTMLElement>("[data-role='txn-filter']");
    if (box) mountFilterBox(box, { category: accountUi.category, query: accountUi.query }, setFilter);
  } else {
    hero.outerHTML = heroHtml(found); // new balance/sync time after a poll
  }
  if (withTrends) {
    renderTrends();
    loadTrends(false);
  }
  void loadAccountData(id, withTrends);
}

const chartCard = () => accountScreen.querySelector<HTMLElement>(".chart-card");
const txnCard = () => accountScreen.querySelector<HTMLElement>(".txn-card");

function drawChart(): void {
  const card = chartCard();
  const data = balanceHistory.peek();
  if (card && data) renderChart(card, data.data, accountUi.id, accountUi.range);
}

function drawTransactions(): void {
  const card = txnCard();
  const data = transactions.peek();
  if (!card || !data) return;
  const cats = categories.peek()?.data.spData ?? null;
  const view = renderTransactions(
    card,
    data.data,
    cats,
    accountUi.id,
    accountUi.page,
    { category: accountUi.category, query: accountUi.query },
    currentSliceResolver(),
  );
  accountUi.page = view.page;
  showOpenTxn();
  // Drop a grouping the filter doesn't offer (e.g. a stale link), once categories are in.
  if (cats && view.category !== accountUi.category) {
    accountUi.category = view.category;
    syncFilterToUrl();
  }
}

/** Transactions plus the category list. A failed category list just leaves the filter out. */
async function loadTransactions(): Promise<void> {
  const isKeyError = (err: unknown) => err instanceof ApiError && (err.kind === "unauthorized" || err.kind === "no-key");
  await Promise.all([
    transactions.get(),
    categories.get().catch((err: unknown) => {
      if (isKeyError(err)) throw err;
      console.warn("Couldn't load transaction categories; showing transactions without the filter.", err);
    }),
    // Your merchant categories (saved on the service). Without them, spending is automatic only.
    loadRules().catch((err: unknown) => {
      if (isKeyError(err)) throw err;
      console.warn("Couldn't load your merchant categories; spending categories are automatic for now.", err);
    }),
  ]);
  await migrateLegacyRules();
}

/**
 * Move rules saved in this browser by the previous version (by transaction name) to the
 * service (by merchant ID), once. Names are matched to merchant IDs through the loaded
 * transactions; a merchant that already has a category on the service keeps it.
 */
let migrating = false;
async function migrateLegacyRules(): Promise<void> {
  const legacy = legacyRules();
  const all = transactions.peek()?.data.spData?.transactions;
  if (!legacy.length || migrating || !rulesLoaded() || !all) return;
  migrating = true;
  try {
    let moved = 0;
    const unmatched: string[] = [];
    for (const r of legacy) {
      const ids = [...new Set(all.filter((t) => t.merchantId && legacyNameKey(t) === r.key).map((t) => t.merchantId!))];
      if (!ids.length) unmatched.push(`“${r.label}”`);
      for (const id of ids) {
        if (ruleById(id)) continue;
        await setRule(id, r.slice);
        moved++;
      }
    }
    dropLegacyRules();
    infoNotice =
      `Moved ${moved} saved categor${moved === 1 ? "y" : "ies"} from this browser to your service.` +
      (unmatched.length ? ` Couldn't match ${unmatched.join(", ")} to a merchant, so ${unmatched.length === 1 ? "it was" : "they were"} dropped.` : "");
  } catch (err) {
    console.warn("Couldn't move your saved categories to the service yet; will try again.", err);
  } finally {
    migrating = false;
  }
}

async function loadAccountData(id: number, withChart: boolean): Promise<void> {
  const still = () => accountUi.id === id && routeAccountId() === id;
  const fill = async (get: () => Promise<unknown>, draw: () => void, card: () => HTMLElement | null, body: string, what: string) => {
    try {
      await get();
      if (still()) draw();
    } catch (err) {
      if (handleKeyError(err) || !still()) return;
      const el = card()?.querySelector<HTMLElement>(`[data-role='${body}']`);
      if (el) el.innerHTML = errorBlock(`Couldn't load ${what}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // Draw from memory straight away when we have it; the get() below refreshes if it's old.
  if (withChart) drawChart();
  drawTransactions();
  await Promise.all([
    withChart ? fill(() => balanceHistory.get(), drawChart, chartCard, "chart-body", "balance history") : null,
    fill(loadTransactions, drawTransactions, txnCard, "txn-body", "transactions"),
  ]);
}

// ---------- Screen transitions ----------

let navToken = 0;
const running: Animation[] = [];
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const screenEl = (name: ScreenName) =>
  ({ dashboard: dashboardScreen, account: accountScreen, subscriptions: subsScreen, spending: spendScreen })[name];
/** Opening an account and going back slide on phones; switching pages fades. */
const isDrillDown = (a: ScreenName, b: ScreenName): boolean =>
  (a === "dashboard" && b === "account") || (a === "account" && b === "dashboard");

/**
 * Switch screens. On phones the current screen slides off one side while the new one
 * slides in from the other (forward: dashboard goes left, account comes from the right;
 * back: the reverse). On wider screens it's a short fade.
 */
async function show(target: ScreenName, animate: boolean): Promise<void> {
  const token = ++navToken;
  const fromName = current;
  const from = screenEl(fromName);
  const to = screenEl(target);
  current = target;

  for (const a of running.splice(0)) a.finish();
  stage.classList.remove("is-sliding");
  from.style.marginTop = "";
  to.style.marginTop = "";

  const fromY = window.scrollY;
  if (fromName === "dashboard") dashboardScroll = fromY;
  const toY = target === "dashboard" ? dashboardScroll : 0;
  if (target === "dashboard") document.title = APP_TITLE;
  to.hidden = false;

  const done = () => {
    from.hidden = true;
    window.scrollTo(0, toY);
    focusAfter(target);
  };

  if (!animate || reducedMotion()) return done();

  if (!isMobile() || !isDrillDown(fromName, target)) {
    done();
    running.push(
      to.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
        duration: 180,
        easing: "ease-out",
      }),
    );
    return;
  }

  // Both screens share one grid cell while they slide. Each keeps its own scroll
  // position via a negative margin while the page itself sits at the top.
  const dir = target === "account" ? 1 : -1;
  stage.classList.add("is-sliding");
  from.style.marginTop = `${-fromY}px`;
  to.style.marginTop = `${-toY}px`;
  window.scrollTo(0, 0);
  const opts: KeyframeAnimationOptions = { duration: 340, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" };
  running.push(
    from.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dir * 100}vw)` }], opts),
    to.animate([{ transform: `translateX(${dir * 100}vw)` }, { transform: "translateX(0)" }], opts),
  );
  await Promise.allSettled(running.map((a) => a.finished));
  if (token !== navToken) return;
  running.length = 0;
  stage.classList.remove("is-sliding");
  from.style.marginTop = "";
  to.style.marginTop = "";
  done();
}

/** Move focus for keyboard and screen-reader users after a screen change. */
function focusAfter(target: ScreenName): void {
  if (target === "subscriptions" || target === "spending") {
    screenEl(target).querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  } else if (target === "account") {
    accountScreen.querySelector<HTMLElement>("[data-action='back']")?.focus({ preventScroll: true });
  } else {
    content.querySelector<HTMLElement>(`[data-account-id='${accountUi.id}'] .acct__open`)?.focus({ preventScroll: true });
  }
}

/** Back to the dashboard without animation (errors, key prompt). */
function leaveToDashboardNow(): void {
  if (location.hash && location.hash !== "#") history.replaceState(null, "", location.pathname + location.search);
  appliedHash = location.hash;
  updateNav();
  if (current !== "dashboard") void show("dashboard", false);
}

// ---------- Subscriptions screen ----------

/** The expanded subscription panel, if any (one at a time). */
let openSub: string | null = null;

function renderSubscriptionsScreen(): void {
  document.title = `Subscriptions · ${APP_TITLE}`;
  if (!subsScreen.querySelector(".subs-screen")) subsScreen.innerHTML = subscriptionsShellHtml();
  void loadSubscriptions();
}

/** Detect and draw from the cached transactions (and category list, if loaded). */
function drawSubscriptions(): void {
  const data = transactions.peek()?.data;
  if (!data || !isSubscriptionsRoute()) return;
  const spData = data.spData;
  const today = new Date();
  const asOf =
    spData?.endDate ??
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const subs = detectSubscriptions(spData?.transactions ?? [], {
    asOf,
    categories: categories.peek()?.data.spData ?? null,
    accountName: (id) => (summary && typeof id === "number" ? findAccount(summary, id)?.account.name : undefined),
  });
  renderSubscriptions(subsScreen, subs, { start: spData?.startDate, end: spData?.endDate }, routeSubSort());
  showOpenSub();
}

async function loadSubscriptions(): Promise<void> {
  // Draw straight away from memory when both lists are there; the loads refresh them if old.
  if (transactions.peek() && categories.peek()) drawSubscriptions();
  try {
    await loadTransactions();
    drawSubscriptions();
  } catch (err) {
    if (handleKeyError(err) || !isSubscriptionsRoute()) return;
    const body = subsScreen.querySelector<HTMLElement>("[data-role='subs-body']");
    if (body) body.innerHTML = `<section class="card">${errorBlock(`Couldn't load transactions: ${err instanceof Error ? err.message : String(err)}`)}</section>`;
  }
}

// ---------- Spending screen ----------

/** The list under the chart: its page, expanded row and last rule change, reset when the period or slice changes. */
let spendingUi: {
  view: string;
  page: number;
  openTxn: string | null;
  /** The last category change (with what to restore on Undo), or a save error. */
  notice: { text: string; undo?: { merchantId: string; category: string | null }; error?: boolean } | null;
} = { view: "", page: 0, openTxn: null, notice: null };
/** A one-off message (e.g. after moving old rules), shown until the next category change. */
let infoNotice: string | null = null;

/** Automatic slice + your rule for any loaded transaction (used by the category picker in transaction details). */
function currentSliceResolver() {
  const data = transactions.peek()?.data;
  if (!data) return undefined;
  return sliceResolver(data.spData?.transactions ?? [], categories.peek()?.data.spData ?? null, data.spData?.endDate ?? todayYmd());
}

function noticeHtml(): string {
  const n = spendingUi.notice;
  if (!n) return infoNotice ? `<p class="spend-notice" role="status">${esc(infoNotice)}</p>` : "";
  const undo = n.undo ? ` <button type="button" class="link-btn small" data-action="undo-rule">Undo</button>` : "";
  return `<p class="spend-notice${n.error ? " is-error" : ""}" role="${n.error ? "alert" : "status"}">${esc(n.text)}${undo}</p>`;
}

/** Latest description per merchantId, for naming merchants in the rules list. */
const merchantNames = new WeakMap<object, Map<string, string>>();
function merchantName(merchantId: string): string | undefined {
  const all = transactions.peek()?.data.spData?.transactions;
  if (!all) return undefined;
  let names = merchantNames.get(all);
  if (!names) {
    names = new Map();
    for (const t of [...all].sort((a, b) => (a.transactionDate ?? "").localeCompare(b.transactionDate ?? ""))) {
      if (t.merchantId && t.description) names.set(t.merchantId, t.description);
    }
    merchantNames.set(all, names);
  }
  return names.get(merchantId);
}

/**
 * Set a merchant's spending category (null: back to automatic). The screen updates at
 * once; if saving to the service fails, the change is undone and the error shown.
 */
async function applyRule(merchantId: string, label: string, slice: SliceKey | null, focusKey?: string): Promise<void> {
  const before = ruleById(merchantId);
  if ((before?.slice ?? null) === slice && (slice !== null || !before)) return;
  const saving = setRule(merchantId, slice); // updates the list straight away
  const all = transactions.peek()?.data.spData?.transactions ?? [];
  const n = all.filter((t) => t.merchantId === merchantId).length;
  const where = slice ? `now count as ${SLICES.find((s) => s.key === slice)?.label}` : "are back to automatic";
  infoNotice = null;
  spendingUi.notice = {
    text: `${n} “${label}” transaction${n === 1 ? "" : "s"} ${where}.`,
    undo: { merchantId, category: before?.category ?? null },
  };
  redrawAfterRule(focusKey);
  try {
    await saving;
  } catch (err) {
    if (handleKeyError(err)) return;
    spendingUi.notice = {
      text: `Couldn't save the category for “${label}”: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
    redrawAfterRule(focusKey);
  }
}

/** Redraw whichever screen shows spending categories after a rule changes. */
function redrawAfterRule(focusKey?: string): void {
  if (current === "spending") drawSpending();
  else if (current === "account") drawTransactions();
  if (focusKey) {
    root.querySelector<HTMLElement>(`select[data-spend-assign="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
}
const spendList = () => spendScreen.querySelector<HTMLElement>("[data-role='spend-list']");

function renderSpendingScreen(): void {
  document.title = `Spending · ${APP_TITLE}`;
  if (!spendScreen.querySelector(".spend-screen")) spendScreen.innerHTML = spendingShellHtml();
  void loadSpending();
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function drawSpending(): void {
  const data = transactions.peek()?.data;
  if (!data || !isSpendingRoute()) return;
  const { range, slice } = routeSpending();
  const view = `${range}|${slice ?? ""}`;
  if (spendingUi.view !== view) spendingUi = { view, page: 0, openTxn: null, notice: null };

  const cats = categories.peek()?.data.spData ?? null;
  const b = spendingBreakdown(data.spData?.transactions ?? [], cats, range, data.spData?.endDate ?? todayYmd(), data.spData?.startDate);
  renderSpendingChart(spendScreen, b, range, slice, merchantName);

  const list = spendList();
  if (!list) return;
  const sel = b.slices.find((s) => s.key === slice);
  if (!sel) {
    list.innerHTML = noticeHtml() + spendingListHeadHtml(b, null);
    return;
  }
  const pages = Math.max(1, Math.ceil(sel.transactions.length / PAGE_SIZE));
  spendingUi.page = Math.min(Math.max(0, spendingUi.page), pages - 1);
  const accountOf = (t: Transaction) =>
    (summary && typeof t.userAccountId === "number" ? findAccount(summary, t.userAccountId)?.account.name : undefined) ?? t.accountName;
  list.innerHTML =
    noticeHtml() +
    spendingListHeadHtml(b, slice) +
    (sel.transactions.length
      ? pagedTransactionsHtml(sel.transactions, cats ? indexCategories(cats) : null, spendingUi.page, accountOf, currentSliceResolver())
      : `<p class="muted txn-empty">No ${sel.label.toLowerCase()} transactions in this period.</p>`);
  showOpenTxn(list, spendingUi.openTxn);
}

async function loadSpending(): Promise<void> {
  if (transactions.peek() && categories.peek()) drawSpending();
  try {
    await loadTransactions();
    drawSpending();
  } catch (err) {
    if (handleKeyError(err) || !isSpendingRoute()) return;
    const host = spendScreen.querySelector<HTMLElement>("[data-role='spend-chart']");
    if (host) host.innerHTML = errorBlock(`Couldn't load transactions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function showOpenSub(): void {
  for (const row of subsScreen.querySelectorAll<HTMLElement>(".sub[data-sub-key]")) {
    const open = row.dataset.subKey === openSub;
    row.classList.toggle("is-open", open);
    row.querySelector(".sub__row")?.setAttribute("aria-expanded", String(open));
    const details = row.querySelector<HTMLElement>(".sub__details");
    if (details) details.hidden = !open;
  }
}

/** History entries for accounts opened from the dashboard carry this, so Back can use history.back(). */
const FROM_DASHBOARD = { fromDashboard: true };
const openedFromDashboard = (): boolean =>
  (history.state as { fromDashboard?: boolean } | null)?.fromDashboard === true;

function goBack(): void {
  if (openedFromDashboard()) {
    history.back(); // fires hashchange → applyRoute(true)
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    applyRoute(true);
  }
}

function openAccount(id: number): void {
  history.pushState(FROM_DASHBOARD, "", `#/account/${id}`);
  applyRoute(true); // pushState doesn't fire hashchange
}

// Browsers fire both popstate and hashchange for one navigation; act once per URL change.
const onNavigate = () => {
  if (location.hash !== appliedHash) applyRoute(true);
};
window.addEventListener("popstate", onNavigate);
window.addEventListener("hashchange", onNavigate);

// ---------- Errors ----------

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.kind === "network") {
    return errorHtml(
      "Can't reach your service",
      `<p>The request to <code>${esc(API_BASE)}</code> didn't get through. Usually one of these:</p>
       <ul>
         <li><strong>Service not running or not reachable.</strong> Check the service on your PC and that the router still forwards port 44300. Opening <a href="${esc(API_BASE)}/status" target="_blank" rel="noopener">the service's status page</a> should show an "invalid API key" message.</li>
         <li><strong>Certificate problem.</strong> If that page shows a certificate warning instead, the service's Let's Encrypt certificate may have expired (it needs renewing every 90 days).</li>
         <li><strong>Service doesn't allow this site (CORS).</strong> It must accept requests from <code>${esc(location.origin)}</code> with the <code>X-API-Key</code> header.</li>
       </ul>`,
    );
  }
  if (err instanceof ApiError && err.kind === "not-found") {
    return errorHtml(
      "No summary saved yet",
      `<p>The service is running but hasn't saved the summary yet. It saves every 15 minutes; check <code>${esc(API_BASE)}/status</code> for details.</p>`,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorHtml("Something went wrong", `<p>${esc(message)}</p>`);
}

// ---------- Events ----------

root.addEventListener("click", (e) => {
  const el = e.target as Element;

  if (el.closest("[data-action='forget-key']")) {
    e.preventDefault();
    clearApiKey();
    showKeyForm();
    return;
  }

  if (el.closest("[data-action='reload']")) {
    e.preventDefault();
    void load(false);
    if (selected === "investments") loadTrends(true);
    if (current === "account" || current === "subscriptions" || current === "spending") {
      balanceHistory.clear();
      transactions.clear();
      // Pick up category changes made on another device.
      if (current !== "subscriptions") void loadRules(true).catch(() => {});
    }
    return;
  }

  if (el.closest("[data-action='back']")) {
    e.preventDefault();
    goBack();
    return;
  }

  // Account screen: chart range and transaction pages.
  const rangeBtn = el.closest<HTMLElement>("[data-range]");
  if (rangeBtn) {
    accountUi.range = rangeBtn.dataset.range as ChartRange;
    drawChart();
    return;
  }
  // Spending category rules: remove one, or undo the last change.
  const removeBtn = el.closest<HTMLElement>("[data-rule-remove]");
  if (removeBtn) {
    const id = removeBtn.dataset.ruleRemove ?? "";
    void applyRule(id, merchantName(id) ?? id, null);
    return;
  }
  if (el.closest("[data-action='undo-rule']")) {
    const undo = spendingUi.notice?.undo;
    if (undo) {
      spendingUi.notice = null;
      const saving = setCategory(undo.merchantId, undo.category);
      redrawAfterRule();
      saving.catch((err: unknown) => {
        if (handleKeyError(err)) return;
        spendingUi.notice = { text: `Couldn't undo: ${err instanceof Error ? err.message : String(err)}`, error: true };
        redrawAfterRule();
      });
    }
    return;
  }

  // Spending: period switch and slice selection (kept in the URL, replacing the history entry).
  const rangeSwitch = el.closest<HTMLElement>("[data-spend-range]");
  if (rangeSwitch) {
    const range = rangeSwitch.dataset.spendRange ?? "month";
    if (isRangeKey(range)) setSpendingUrl(range, routeSpending().slice);
    drawSpending();
    spendScreen.querySelector<HTMLElement>(`[data-spend-range='${range}']`)?.focus({ preventScroll: true });
    return;
  }
  const sliceBtn = el.closest<HTMLElement | SVGElement>("[data-spend-slice]");
  if (sliceBtn) {
    const key = sliceBtn.dataset.spendSlice ?? null;
    const { range, slice } = routeSpending();
    const next = isSliceKey(key) && key !== slice ? key : null;
    setSpendingUrl(range, next);
    drawSpending();
    const legendBtn = spendScreen.querySelector<HTMLElement>(`.spend-key[data-spend-slice='${key}']`);
    if (sliceBtn.closest(".spend-legend, .spend-donut")) legendBtn?.focus({ preventScroll: true });
    // Bring the transactions into view when a slice is picked.
    const list = spendList();
    if (next && list && list.getBoundingClientRect().top > window.innerHeight - 120) {
      list.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    return;
  }

  // Subscriptions: sort order (kept in the URL, replacing the history entry).
  const sortBtn = el.closest<HTMLElement>("[data-sub-sort]");
  if (sortBtn) {
    const sort = sortBtn.dataset.subSort ?? "name";
    history.replaceState(history.state, "", sort === "name" ? "#/subscriptions" : `#/subscriptions?sort=${sort}`);
    appliedHash = location.hash;
    drawSubscriptions();
    subsScreen.querySelector<HTMLElement>(`[data-sub-sort='${sort}']`)?.focus({ preventScroll: true });
    return;
  }

  // Subscriptions: open a panel's charges, closing any other; click an open panel to close it.
  const subToggle = el.closest<HTMLElement>("[data-sub-toggle]");
  if (subToggle) {
    const key = subToggle.dataset.subToggle ?? null;
    const row = subToggle.closest<HTMLElement>(".sub");
    const before = row?.getBoundingClientRect().top ?? 0;
    openSub = openSub === key ? null : key;
    showOpenSub();
    if (row) {
      window.scrollBy(0, row.getBoundingClientRect().top - before);
      if (openSub === key && row.getBoundingClientRect().bottom > window.innerHeight) {
        row.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }
    return;
  }

  // Transactions: open a row's details, closing any other; click an open row to close it.
  const txnToggle = el.closest<HTMLElement>("[data-txn-toggle]");
  if (txnToggle) {
    const key = txnToggle.dataset.txnToggle ?? null;
    const row = txnToggle.closest<HTMLElement>(".txn");
    const before = row?.getBoundingClientRect().top ?? 0;
    // The account screen and the Spending list each keep their own open row.
    const ui = txnToggle.closest("#spending") ? spendingUi : accountUi;
    ui.openTxn = ui.openTxn === key ? null : key;
    if (ui === spendingUi) showOpenTxn(spendList(), ui.openTxn);
    else showOpenTxn();
    // Closing a taller row above would shift this one up: keep it where it was clicked.
    if (row) {
      window.scrollBy(0, row.getBoundingClientRect().top - before);
      if (ui.openTxn === key) {
        const r = row.getBoundingClientRect();
        if (r.bottom > window.innerHeight) row.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }
    return;
  }

  if (el.closest("[data-action='clear-filter']")) {
    setFilter({ category: ALL, query: "" });
    return;
  }
  const pageBtn = el.closest<HTMLButtonElement>("[data-page]");
  if (pageBtn && !pageBtn.disabled && pageBtn.closest("#spending")) {
    spendingUi.page = Number(pageBtn.dataset.page);
    spendingUi.openTxn = null;
    drawSpending();
    const list = spendList();
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }
  if (pageBtn && !pageBtn.disabled) {
    accountUi.page = Number(pageBtn.dataset.page);
    accountUi.openTxn = null;
    drawTransactions();
    const card = txnCard();
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }

  // Investment rows open the account screen (the link inside handles keyboard use).
  const row = el.closest<HTMLElement>("[data-account-id]");
  if (row) {
    e.preventDefault();
    openAccount(Number(row.dataset.accountId));
    return;
  }

  // Tiles: select to show that category's accounts; select again to hide them.
  const tile = el.closest<HTMLElement>(".tile[data-category]");
  if (tile) {
    const category = tile.dataset.category as Category;
    selected = selected === category ? null : category;
    applySelection(content, selected);
    if (selected === "investments") loadTrends(false);
  }
});

/** Reflect accountUi.openTxn in the transaction rows. */
/** Reflect the open row in a transaction list (the account screen's by default). */
function showOpenTxn(card: HTMLElement | null = txnCard(), openKey: string | null = accountUi.openTxn): void {
  if (!card) return;
  for (const row of card.querySelectorAll<HTMLElement>(".txn[data-txn-key]")) {
    const open = row.dataset.txnKey === openKey;
    row.classList.toggle("is-open", open);
    row.querySelector(".txn__row")?.setAttribute("aria-expanded", String(open));
    const details = row.querySelector<HTMLElement>(".txn__details");
    if (details) details.hidden = !open;
  }
}

function setFilter(filter: FilterState): void {
  accountUi.category = filter.query ? ALL : filter.category;
  accountUi.query = filter.query;
  accountUi.page = 0;
  accountUi.openTxn = null;
  syncFilterToUrl();
  drawTransactions();
}

// Spending category pickers: in a transaction's details, and in the rules list.
root.addEventListener("change", (e) => {
  const target = e.target as Element;
  const assign = target.closest<HTMLSelectElement>("select[data-spend-assign]");
  if (assign) {
    const id = assign.dataset.spendAssign ?? "";
    void applyRule(id, assign.dataset.label ?? id, isSliceKey(assign.value) ? assign.value : null, id);
    return;
  }
  const ruleSelect = target.closest<HTMLSelectElement>("select[data-rule-key]");
  if (ruleSelect && isSliceKey(ruleSelect.value)) {
    const id = ruleSelect.dataset.ruleKey ?? "";
    void applyRule(id, ruleSelect.dataset.ruleLabel ?? id, ruleSelect.value);
    spendScreen.querySelector<HTMLElement>(`select[data-rule-key="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
});

root.addEventListener("submit", (e) => {
  const form = (e.target as Element).closest<HTMLFormElement>("[data-form='api-key']");
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  const key = String(data.get("apiKey") ?? "").trim();
  if (!key) return;
  setApiKey(key, data.get("remember") === "on");
  void load(true);
});

// Keep "saved x minutes ago" current, and re-read the file periodically.
setInterval(renderFreshness, 30_000);
setInterval(() => {
  if (document.visibilityState === "visible" && getApiKey()) void load(false);
}, POLL_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && savedAt && Date.now() - savedAt.getTime() > POLL_MS) {
    void load(false);
  }
});

// A deep link to an account (#/account/<id>) opens it once the summary loads; the
// Subscriptions page doesn't need the summary, so it opens straight away.
updateNav();
void load(true);
if ((isSubscriptionsRoute() || isSpendingRoute()) && getApiKey()) applyRoute(false);
