// Settings screen: household details, reload saved data, refresh institutions (with status), forget the API key.

import { dateTime, esc, timeAgo } from "./format";
import { icons } from "./icons";
import type { InstitutionRefreshStatus, InstitutionResult } from "./types";
import { appSettingsCardHtml } from "./appsettings";

export function settingsShellHtml(apiBase: string): string {
  return `
  <div class="settings-screen">
    <div class="page-head">
      <div>
        <h1 tabindex="-1">Settings</h1>
        <div class="muted small">Refresh your data and manage this browser's connection to the service.</div>
      </div>
    </div>

    ${appSettingsCardHtml()}

    <section class="card setting" aria-labelledby="set-reload">
      <div class="setting__text">
        <h2 class="setting__title" id="set-reload">Reload saved data</h2>
        <p class="setting__desc">Loads the newest data the service has already saved. The service checks Empower every
          15 minutes on its own, so this is quick and doesn't contact your banks.</p>
        <div class="setting__meta" data-role="settings-freshness"></div>
      </div>
      <div class="setting__actions">
        <button class="btn btn--accent" data-action="reload">${icons.refresh}<span>Reload data</span></button>
      </div>
    </section>

    <section class="card setting setting--stack" aria-labelledby="set-inst">
      <div class="setting__row">
        <div class="setting__text">
          <h2 class="setting__title" id="set-inst">Refresh institutions</h2>
          <p class="setting__desc">Asks Empower to pull new balances and transactions from every bank and brokerage,
            then re-fetches all of your data. It runs in the background and can take a few minutes. Logins that need
            you (such as a two-factor prompt) are skipped.</p>
          <label class="check setting__check">
            <input type="checkbox" data-role="ri-force" />
            <span><strong>Force refresh</strong> — also include institutions refreshed in the last hour (normally skipped)</span>
          </label>
        </div>
        <div class="setting__actions">
          <button class="btn btn--accent" data-action="refresh-institutions">${icons.bank}<span>Refresh institutions</span></button>
          <button class="btn btn--ghost" data-action="check-ri-status">${icons.clock}<span>Check status</span></button>
        </div>
      </div>
      <div class="ri-status" data-role="ri-status" aria-live="polite"></div>
    </section>

    <section class="card setting" aria-labelledby="set-key">
      <div class="setting__text">
        <h2 class="setting__title" id="set-key">API key</h2>
        <p class="setting__desc">Removes the API key saved in this browser. You'll need to enter it again to see your
          data here. Connected to <code>${esc(apiBase)}</code>.</p>
      </div>
      <div class="setting__actions">
        <button class="btn btn--danger-ghost" data-action="forget-key">${icons.logout}<span>Forget API key</span></button>
      </div>
    </section>
  </div>`;
}

// ---------- Institution refresh status ----------

export interface RiView {
  status: InstitutionRefreshStatus | null;
  /** When `status` was fetched. */
  checkedAt: Date | null;
  /** A request is in flight. */
  busy: "start" | "check" | null;
  /** Last request's problem, shown above the (possibly older) status. */
  problem: string | null;
  /** The "Institutions in the last run" panel is expanded (collapsed by default). */
  instOpen: boolean;
  /** A short note about the last action (e.g. "Started"). */
  note: string | null;
}

const date = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "Nov 27, 2026, 6:00 AM (3 hours ago)" */
function when(iso: string | null | undefined): string {
  const d = date(iso);
  return d ? `${esc(dateTime(d))} <span class="muted">(${esc(timeAgo(d))})</span>` : `<span class="muted">—</span>`;
}

function schedule(s: InstitutionRefreshStatus): string {
  if (s.enabled === false) return "Off";
  if (s.dailyAt) {
    const [h, m] = s.dailyAt.split(":").map(Number);
    const t = new Date(2000, 0, 1, h ?? 0, m ?? 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `Daily at ${t}`;
  }
  if (s.intervalMinutes) {
    const n = s.intervalMinutes;
    return n % 60 === 0 ? `Every ${n / 60} hour${n === 60 ? "" : "s"}` : `Every ${n} minutes`;
  }
  return "—";
}

const TRIGGERS: Record<string, string> = { manual: "Manual", schedule: "Scheduled", startup: "Catch-up after restart" };

function stateBadge(s: InstitutionRefreshStatus): string {
  if (s.running) return `<span class="ri-badge ri-badge--running"><i class="ri-spinner" aria-hidden="true"></i>Refreshing…</span>`;
  if (s.error) return `<span class="ri-badge ri-badge--bad">${icons.alert}Last run failed</span>`;
  if (s.lastFinished) return `<span class="ri-badge ri-badge--ok"><i class="dot" aria-hidden="true"></i>Idle · last run finished</span>`;
  return `<span class="ri-badge">Not run yet</span>`;
}

function institutionRow(i: InstitutionResult): string {
  const action = i.action ?? "";
  const label = action === "refreshed" ? "Refreshed" : action === "skipped" ? "Skipped" : action === "failed" ? "Failed" : action || "—";
  const kind = action === "refreshed" ? "ok" : action === "failed" ? "bad" : "muted";
  const notes: string[] = [];
  if (action === "refreshed" && i.completed === false) notes.push("Empower was still updating when the wait ended");
  if (i.reason) notes.push(esc(i.reason));
  if (i.error) notes.push(esc(i.error));
  const after = date(i.lastRefreshedAfter);
  const accounts = typeof i.accounts === "number" ? `${i.accounts} account${i.accounts === 1 ? "" : "s"}` : "";
  return `
    <li class="ri-inst">
      <div class="ri-inst__text">
        <div class="ri-inst__name">${esc(i.institution || "Institution")}</div>
        <div class="ri-inst__sub">${[accounts, after ? `updated ${esc(timeAgo(after))}` : ""].filter(Boolean).join(" · ")}</div>
        ${notes.length ? `<div class="ri-inst__note">${notes.join(" · ")}</div>` : ""}
      </div>
      <div class="ri-inst__tags">
        ${i.aggregationError ? `<span class="tag tag--warn" title="Fix this in the Empower dashboard">${esc(i.aggregationError)}</span>` : ""}
        <span class="ri-pill ri-pill--${kind}">${esc(label)}</span>
      </div>
    </li>`;
}

/** "2 refreshed · 2 skipped · 1 failed · 1 needs attention" for the collapsed panel. */
function instCounts(insts: InstitutionResult[]): string {
  const n = (action: string) => insts.filter((i) => i.action === action).length;
  const attention = insts.filter((i) => i.aggregationError).length;
  return [
    [n("refreshed"), "refreshed", ""],
    [n("skipped"), "skipped", ""],
    [n("failed"), "failed", "bad"],
    [attention, attention === 1 ? "needs attention" : "need attention", "warn"],
  ]
    .filter(([count]) => count)
    .map(([count, label, kind]) => `<span${kind ? ` class="ri-count--${kind}"` : ""}>${count} ${label}</span>`)
    .join("");
}

export function riStatusHtml(v: RiView): string {
  const parts: string[] = [];
  if (v.problem) parts.push(`<p class="inline-error">${icons.alert}<span>${esc(v.problem)}</span></p>`);
  if (v.note) parts.push(`<p class="ri-note">${esc(v.note)}</p>`);

  const s = v.status;
  if (!s) {
    parts.push(
      v.busy
        ? `<p class="muted small ri-empty">Checking status…</p>`
        : `<p class="muted small ri-empty">Status not checked yet. Use <strong>Check status</strong> to see the last run.</p>`,
    );
    return parts.join("");
  }

  const insts = s.institutions ?? [];
  parts.push(`
    <div class="ri-head">
      ${stateBadge(s)}
      ${v.checkedAt ? `<span class="muted small">Checked ${esc(timeAgo(v.checkedAt))}</span>` : ""}
    </div>
    ${s.outcome ? `<p class="ri-outcome">${esc(s.outcome)}</p>` : ""}
    ${s.error ? `<p class="inline-error">${icons.alert}<span>${esc(s.error)}</span></p>` : ""}
    <dl class="ri-details">
      <div><dt>Started</dt><dd>${when(s.lastStarted)}</dd></div>
      <div><dt>Finished</dt><dd>${s.running ? `<span class="muted">In progress</span>` : when(s.lastFinished)}</dd></div>
      <div><dt>Last successful run</dt><dd>${when(s.lastCompleted)}</dd></div>
      <div><dt>Started by</dt><dd>${esc(s.trigger ? TRIGGERS[s.trigger] ?? s.trigger : "—")}</dd></div>
      <div><dt>Automatic schedule</dt><dd>${esc(schedule(s))}</dd></div>
      <div><dt>Next scheduled run</dt><dd>${s.enabled === false ? `<span class="muted">—</span>` : when(s.nextScheduledRun)}</dd></div>
    </dl>
    ${
      insts.length
        ? `<details class="ri-panel" data-role="ri-insts"${v.instOpen ? " open" : ""}>
             <summary class="ri-panel__head">
               <span class="ri-panel__title">Institutions in ${s.running ? "this" : "the last"} run
                 <span class="count">${insts.length}</span></span>
               <span class="ri-panel__counts">${instCounts(insts)}</span>
               <span class="ri-panel__chev" aria-hidden="true">${icons.chevronDown}</span>
             </summary>
             <ul class="ri-insts">${insts.map(institutionRow).join("")}</ul>
           </details>`
        : ""
    }`);
  return parts.join("");
}
