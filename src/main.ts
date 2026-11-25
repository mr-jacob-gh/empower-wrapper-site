import "./styles.css";
import { API_BASE, ApiError, getNetWorthHistory, getSummary, getTransactions } from "./api";
import { clearApiKey, getApiKey, setApiKey } from "./auth";
import {
  applySelection,
  applyTrends,
  dashboardHtml,
  errorHtml,
  findAccount,
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
  renderChart,
  renderTransactions,
  type ChartRange,
} from "./account";
import { cached } from "./cache";
import { dateTime, esc, timeAgo } from "./format";
import { icons } from "./icons";
import { clearTrends, ensureTrends, trendState } from "./trends";
import type { Summary } from "./types";

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
        <a class="nav__item is-active" href="#" aria-current="page">${icons.dashboard}<span>Dashboard</span></a>
      </nav>
      <div class="sidebar__foot">
        <div class="muted small">Service</div>
        <code class="small">${esc(API_BASE)}</code>
        <button class="link-btn small" data-action="forget-key">${icons.logout}<span>Forget API key</span></button>
      </div>
    </aside>

    <header class="topbar">
      <div class="brand"><span class="brand__mark">${icons.logo}</span><span>Empower</span></div>
      <div class="topbar__actions">
        <button class="icon-btn" data-action="forget-key" aria-label="Forget API key" title="Forget API key">${icons.logout}</button>
        <button class="icon-btn" data-action="reload" aria-label="Refresh">${icons.refresh}</button>
      </div>
    </header>

    <main class="main">
      <div class="stage">
        <div class="screen" data-screen="dashboard">
          <div class="page-head">
            <div>
              <h1>Dashboard</h1>
              <div id="freshness" class="freshness"></div>
            </div>
            <button class="btn btn--accent page-head__btn" data-action="reload">${icons.refresh}<span>Refresh</span></button>
          </div>
          <div id="content"></div>
        </div>
        <div class="screen" data-screen="account" id="account" hidden></div>
      </div>
    </main>
  </div>
`;

const stage = root.querySelector<HTMLDivElement>(".stage")!;
const dashboardScreen = root.querySelector<HTMLDivElement>("[data-screen='dashboard']")!;
const accountScreen = root.querySelector<HTMLDivElement>("#account")!;
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

function clearData(): void {
  summary = null;
  clearTrends();
  balanceHistory.clear();
  transactions.clear();
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
  leaveAccountNow();
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
      leaveAccountNow();
      content.innerHTML = keyFormHtml("The service rejected that key. Check it and try again.");
    } else {
      // Errors are shown on the dashboard screen.
      leaveAccountNow();
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

type ScreenName = "dashboard" | "account";
let current: ScreenName = "dashboard";
/** What the account screen shows; kept across re-renders of the same account. */
let accountUi: { id: number; range: ChartRange; page: number } = { id: -1, range: "90d", page: 0 };
/** Set when the account was opened from the dashboard, so Back can use history.back(). */
let openedFromDashboard = false;
let dashboardScroll = 0;

function routeAccountId(): number | null {
  const m = /^#\/account\/(\d+)$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

/** Show whatever the URL asks for. */
function applyRoute(animate: boolean): void {
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
    accountUi = { id, range: "90d", page: 0 };
    accountScreen.innerHTML = notFoundHtml();
    document.title = APP_TITLE;
    return;
  }
  document.title = `${found.account.name || found.account.originalName || "Account"} · ${APP_TITLE}`;

  const hero = accountScreen.querySelector<HTMLElement>("[data-role='hero']");
  if (fresh || !hero || accountUi.id !== id) {
    if (accountUi.id !== id) accountUi = { id, range: "90d", page: 0 };
    accountScreen.innerHTML = accountScreenHtml(found, accountUi.range);
  } else {
    hero.outerHTML = heroHtml(found); // new balance/sync time after a poll
  }
  renderTrends();
  loadTrends(false);
  void loadAccountData(id);
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
  if (card && data) accountUi.page = renderTransactions(card, data.data, accountUi.id, accountUi.page);
}

async function loadAccountData(id: number): Promise<void> {
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
  drawChart();
  drawTransactions();
  await Promise.all([
    fill(() => balanceHistory.get(), drawChart, chartCard, "chart-body", "balance history"),
    fill(() => transactions.get(), drawTransactions, txnCard, "txn-body", "transactions"),
  ]);
}

// ---------- Screen transitions ----------

let navToken = 0;
const running: Animation[] = [];
const isMobile = () => matchMedia("(max-width: 760px)").matches;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const screenEl = (name: ScreenName) => (name === "dashboard" ? dashboardScreen : accountScreen);

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

  if (!isMobile()) {
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
  if (target === "account") {
    accountScreen.querySelector<HTMLElement>("[data-action='back']")?.focus({ preventScroll: true });
  } else {
    content.querySelector<HTMLElement>(`[data-account-id='${accountUi.id}'] .acct__open`)?.focus({ preventScroll: true });
  }
}

/** Back to the dashboard without animation (errors, key prompt). */
function leaveAccountNow(): void {
  if (routeAccountId() !== null) history.replaceState(null, "", location.pathname + location.search);
  openedFromDashboard = false;
  if (current !== "dashboard") void show("dashboard", false);
}

function goBack(): void {
  if (openedFromDashboard) {
    openedFromDashboard = false;
    history.back(); // fires hashchange → applyRoute(true)
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    applyRoute(true);
  }
}

function openAccount(id: number): void {
  openedFromDashboard = true;
  location.hash = `#/account/${id}`; // fires hashchange → applyRoute(true)
}

window.addEventListener("hashchange", () => {
  if (routeAccountId() === null) openedFromDashboard = false;
  applyRoute(true);
});

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
    if (selected === "investments" || current === "account") loadTrends(true);
    if (current === "account") {
      balanceHistory.clear();
      transactions.clear();
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
  const pageBtn = el.closest<HTMLButtonElement>("[data-page]");
  if (pageBtn && !pageBtn.disabled) {
    accountUi.page = Number(pageBtn.dataset.page);
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

// A deep link to an account (#/account/<id>) opens it once the summary loads.
if (routeAccountId() !== null) {
  // Select the Investments tile so Back lands on the account list.
  selected = "investments";
}
void load(true);
