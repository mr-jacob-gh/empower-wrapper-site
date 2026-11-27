// Zestimate on the Net worth card: the total estimated value of the tracked addresses,
// from the service's saved Zillow lookups (GET /zestimate, which never uses APIllow quota).
// Shown alongside net worth, not added to it.

import { dateTime, esc, money, signedMoney, signedPercent, timeAgo } from "./format";
import { icons } from "./icons";
import type { Zestimate, ZestimateList } from "./types";

export type HomeState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; list: ZestimateList; addresses: string[] };

const norm = (s: string): string => s.toLowerCase().replace(/[\s,.]+/g, " ").trim();

/** Market value, or the list price for a home that's for sale (Zillow gives no Zestimate then). */
const valueOf = (z: Zestimate): { value: number | null; listPrice: boolean } =>
  typeof z.zestimate === "number"
    ? { value: z.zestimate, listPrice: false }
    : typeof z.price === "number"
      ? { value: z.price, listPrice: true }
      : { value: null, listPrice: false };

interface Row {
  address: string;
  result: Zestimate | null;
}

/**
 * One row per tracked address: the setting's addresses (so new ones show as "not looked up yet"),
 * plus any result the service still marks as tracked. Untracked results are left out.
 */
function rows(list: ZestimateList, addresses: string[]): Row[] {
  const results = (list.results ?? []).filter((r) => r.tracked !== false);
  const out: Row[] = [];
  const used = new Set<Zestimate>();
  for (const a of addresses) {
    const r = results.find((x) => !used.has(x) && x.address && norm(x.address) === norm(a)) ?? null;
    if (r) used.add(r);
    out.push({ address: a, result: r });
  }
  for (const r of results) if (!used.has(r)) out.push({ address: r.address ?? "Address", result: r });
  return out;
}

const date = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Change since the previous successful lookup, e.g. "+$2,300 (+0.53%) since Nov 26". */
function changeHtml(z: Zestimate): string {
  const h = (z.history ?? []).filter((e) => typeof e.zestimate === "number");
  if (h.length < 2) return "";
  const prev = h[h.length - 2]!;
  const last = h[h.length - 1]!;
  const diff = last.zestimate! - prev.zestimate!;
  const when = date(prev.fetchedAt);
  const cls = diff > 0 ? "delta--up" : diff < 0 ? "delta--down" : "delta--flat";
  const pct = prev.zestimate ? ` (${signedPercent(diff / prev.zestimate)})` : "";
  return `<span class="home-row__change ${cls}">${diff === 0 ? "No change" : esc(signedMoney(diff) + pct)}${
    when ? ` since ${esc(when.toLocaleDateString("en-US", { month: "short", day: "numeric" }))}` : ""
  }</span>`;
}

function rowHtml({ address, result: z }: Row): string {
  if (!z) {
    return `
      <li class="home-row">
        <div class="home-row__text"><div class="home-row__addr">${esc(address)}</div>
          <div class="home-row__sub">Not looked up yet</div></div>
        <strong class="home-row__value home-row__value--pending">Pending</strong>
      </li>`;
  }
  const { value, listPrice } = valueOf(z);
  const fetched = date(z.fetchedAt);
  const sub = [
    fetched ? `Updated ${esc(timeAgo(fetched))}` : "",
    typeof z.rentZestimate === "number" ? `Rent estimate ${esc(money(z.rentZestimate))}/mo` : "",
  ].filter(Boolean);
  return `
    <li class="home-row">
      <div class="home-row__text">
        <div class="home-row__addr">${esc(z.address || address)}</div>
        ${sub.length ? `<div class="home-row__sub"${fetched ? ` title="${esc(dateTime(fetched))}"` : ""}>${sub.join(" · ")}</div>` : ""}
        ${z.lastError ? `<div class="home-row__warn">Latest lookup failed: ${esc(z.lastError)}</div>` : ""}
      </div>
      <div class="home-row__right">
        <strong class="home-row__value">${value !== null ? esc(money(value)) : "—"}</strong>
        ${listPrice ? `<span class="home-row__sub">List price (for sale)</span>` : changeHtml(z)}
      </div>
    </li>`;
}

function panelHtml(list: ZestimateList, addresses: string[]): string {
  const next = date(list.nextScheduledRun);
  const schedule = list.running
    ? "Looking up values now…"
    : next
      ? `The service looks these up daily; next lookup ${esc(timeAgo(next))}.`
      : "The service looks these up daily.";
  return `
    <ul class="home-rows">${rows(list, addresses).map(rowHtml).join("")}</ul>
    ${list.lastRun?.error ? `<p class="home-panel__warn">${icons.alert}<span>Last lookup run failed: ${esc(list.lastRun.error)}</span></p>` : ""}
    <p class="dti-panel__note">Zillow Zestimates for the addresses in Settings → Household details. ${schedule}
      Shown for reference; not added to net worth.</p>`;
}

/** Total of the known values; null if none are known yet. */
export function totalValue(list: ZestimateList, addresses: string[]): number | null {
  const values = rows(list, addresses)
    .map((r) => (r.result ? valueOf(r.result).value : null))
    .filter((v): v is number => v !== null);
  return values.length ? values.reduce((t, v) => t + v, 0) : null;
}

/** Fill the Net worth card's Zestimate slot and its breakdown. Call after each render and state change. */
export function applyHomeValue(container: ParentNode, state: HomeState, open: boolean): void {
  const slot = container.querySelector<HTMLElement>("[data-role='home']");
  const panel = container.querySelector<HTMLElement>("[data-role='home-panel']");
  if (!slot || !panel) return;
  const label = `<span>Zestimate</span>`;
  let ready = false;
  if (state.kind === "loading") {
    slot.innerHTML = `${label}<strong class="hero__pending" aria-label="Loading">…</strong>`;
  } else if (state.kind === "none") {
    slot.innerHTML = `${label}<a class="hero__link" href="#/settings">Add address</a>`;
  } else if (state.kind === "error") {
    slot.innerHTML = `${label}<strong title="${esc(state.message)}" aria-label="Unavailable: ${esc(state.message)}">—</strong>`;
  } else {
    const total = totalValue(state.list, state.addresses);
    const count = rows(state.list, state.addresses).length;
    const shown = total !== null ? money(total) : "Pending";
    slot.innerHTML = `${label}<button type="button" class="hero__dti-btn" data-action="toggle-home" aria-expanded="${open}"
      aria-controls="home-panel" title="${count === 1 ? "Property details" : `Total of ${count} properties`}"><strong>${esc(shown)}</strong>${icons.chevronDown}</button>`;
    panel.innerHTML = panelHtml(state.list, state.addresses);
    ready = true;
  }
  panel.hidden = !(open && ready);
  slot.classList.toggle("is-open", open && ready);
}
