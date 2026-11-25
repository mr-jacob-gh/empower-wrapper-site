import "./styles.css";
import { API_BASE, ApiError, getSummary } from "./api";
import { applySelection, dashboardHtml, errorHtml, loadingHtml, type Category } from "./dashboard";
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
      </div>
    </aside>

    <header class="topbar">
      <div class="brand"><span class="brand__mark">${icons.logo}</span><span>Empower</span></div>
      <button class="icon-btn" data-action="reload" aria-label="Refresh">${icons.refresh}</button>
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

async function load(showSkeleton: boolean): Promise<void> {
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
    content.innerHTML = describeError(err);
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
      `<p>Nothing answered at <code>${esc(API_BASE)}</code>.</p>
       <ul>
         <li>Check that the Empower service is running on this computer.</li>
         <li>If it is, the browser may have blocked the request: the service needs to allow this site's origin (CORS), and some browsers ask permission before a website can reach <code>localhost</code>.</li>
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

// Keep "saved x minutes ago" current, and re-read the file periodically.
setInterval(renderFreshness, 30_000);
setInterval(() => {
  if (document.visibilityState === "visible") void load(false);
}, POLL_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && savedAt && Date.now() - savedAt.getTime() > POLL_MS) {
    void load(false);
  }
});

void load(true);
