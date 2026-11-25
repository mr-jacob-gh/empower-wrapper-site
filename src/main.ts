import "./styles.css";
import { API_BASE, ApiError, getSummary } from "./api";
import { clearApiKey, getApiKey, setApiKey } from "./auth";
import { applySelection, dashboardHtml, errorHtml, keyFormHtml, loadingHtml, type Category } from "./dashboard";
import { dateTime, esc, timeAgo } from "./format";
import { icons } from "./icons";

/** The service saves every 15 minutes; flag data older than this as stale. */
const STALE_AFTER_MS = 30 * 60 * 1000;
/** Re-read the saved file this often while the tab is visible. */
const POLL_MS = 5 * 60 * 1000;

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
      <div class="page-head">
        <div>
          <h1>Dashboard</h1>
          <div id="freshness" class="freshness"></div>
        </div>
        <button class="btn btn--accent page-head__btn" data-action="reload">${icons.refresh}<span>Refresh</span></button>
      </div>
      <div id="content"></div>
    </main>
  </div>
`;

const content = root.querySelector<HTMLDivElement>("#content")!;
const freshness = root.querySelector<HTMLDivElement>("#freshness")!;

let savedAt: Date | null = null;
/** Tile whose accounts are showing; kept across re-renders. */
let selected: Category | null = null;
let inFlight: AbortController | null = null;

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
  savedAt = null;
  renderFreshness();
  content.innerHTML = keyFormHtml(problem);
  content.querySelector<HTMLInputElement>("input[name='apiKey']")?.focus();
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
    content.innerHTML = dashboardHtml(result.data);
    applySelection(content, selected);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    savedAt = null;
    if (err instanceof ApiError && err.kind === "unauthorized") {
      clearApiKey();
      content.innerHTML = keyFormHtml("The service rejected that key. Check it and try again.");
    } else {
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
    return;
  }

  // Tiles: select to show that category's accounts; select again to hide them.
  const tile = el.closest<HTMLElement>(".tile[data-category]");
  if (tile) {
    const category = tile.dataset.category as Category;
    selected = selected === category ? null : category;
    applySelection(content, selected);
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

void load(true);
