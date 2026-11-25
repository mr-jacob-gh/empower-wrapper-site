// A single-series line chart in inline SVG (no dependencies).
// 2px line, end dot, hairline solid grid, crosshair + tooltip that snaps to the
// nearest day on hover, and arrow-key stepping when the chart has focus.

import { esc, money, moneyCents, shortDate } from "./format";

export interface Point {
  /** `yyyy-MM-dd` */
  date: string;
  value: number;
}

const observers = new WeakMap<HTMLElement, ResizeObserver>();

/** Draw `points` into `host` (re-drawn when its width changes). */
export function mountLineChart(host: HTMLElement, points: Point[], label: string): void {
  observers.get(host)?.disconnect();
  let lastWidth = 0;
  const draw = () => {
    const width = Math.round(host.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    render(host, points, label, width);
  };
  const ro = new ResizeObserver(draw);
  ro.observe(host);
  observers.set(host, ro);
  draw();
}

// ---------- Rendering ----------

const DAY_MS = 86_400_000;
export const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS;
};
const longDate = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count - 1);
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function yTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.01);
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, 4);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  measureCtx.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  return measureCtx.measureText(text).width;
}

function render(host: HTMLElement, points: Point[], label: string, width: number): void {
  const height = width < 480 ? 190 : 240;
  const ticks = yTicks(Math.min(...points.map((p) => p.value)), Math.max(...points.map((p) => p.value)));
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 1;
  const fmtTick = (v: number) => (step < 1 ? moneyCents(v) : money(v));
  const tickLabels = ticks.map(fmtTick);

  const padL = Math.ceil(Math.max(...tickLabels.map(textWidth))) + 12;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = height - padT - padB;

  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const d0 = dayNumber(points[0]!.date);
  const d1 = dayNumber(points[points.length - 1]!.date);
  const x = (p: Point) => (d1 === d0 ? padL + plotW / 2 : padL + ((dayNumber(p.date) - d0) / (d1 - d0)) * plotW);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const xs = points.map(x);

  // Grid + y labels
  const grid = ticks
    .map((t, i) => {
      const ty = y(t).toFixed(1);
      return `<line class="chart__grid" x1="${padL}" x2="${width - padR}" y1="${ty}" y2="${ty}"/>
        <text class="chart__axis" x="${padL - 8}" y="${ty}" text-anchor="end" dominant-baseline="middle">${esc(tickLabels[i])}</text>`;
    })
    .join("");

  // X labels: up to 3 (narrow) or 5, evenly spaced by index, always first and last.
  const maxLabels = Math.min(points.length, width < 480 ? 3 : 5);
  const idx = new Set<number>();
  for (let k = 0; k < maxLabels; k++) idx.add(Math.round((k * (points.length - 1)) / Math.max(1, maxLabels - 1)));
  const xLabels = [...idx]
    .map((i) => {
      const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
      return `<text class="chart__axis" x="${xs[i]!.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}">${esc(shortDate(points[i]!.date))}</text>`;
    })
    .join("");

  const path = points.map((p, i) => `${i ? "L" : "M"}${xs[i]!.toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  const first = points[0]!;

  host.innerHTML = `
    <svg class="chart__svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      ${grid}${xLabels}
      <path class="chart__line" d="${path}"/>
      <circle class="chart__dot" cx="${x(last).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4"/>
      <g class="chart__hover" visibility="hidden">
        <line class="chart__cross" y1="${padT}" y2="${padT + plotH}"/>
        <circle class="chart__dot" r="4.5"/>
      </g>
      <rect class="chart__hit" x="${padL}" y="0" width="${plotW}" height="${height}"/>
    </svg>
    <div class="chart__tip" role="status" aria-live="polite" hidden><strong></strong><span></span></div>`;
  host.tabIndex = 0;
  host.setAttribute("role", "group");
  host.setAttribute(
    "aria-label",
    `${label}: ${moneyCents(first.value)} on ${shortDate(first.date)} to ${moneyCents(last.value)} on ${shortDate(last.date)}. Use the arrow keys to step through days.`,
  );

  // ---------- Hover / keyboard ----------
  const svg = host.querySelector<SVGSVGElement>("svg")!;
  const hover = svg.querySelector<SVGGElement>(".chart__hover")!;
  const cross = hover.querySelector<SVGLineElement>("line")!;
  const dot = hover.querySelector<SVGCircleElement>("circle")!;
  const tip = host.querySelector<HTMLDivElement>(".chart__tip")!;
  const tipValue = tip.querySelector("strong")!;
  const tipDate = tip.querySelector("span")!;
  let current = -1;

  const show = (i: number) => {
    current = Math.max(0, Math.min(points.length - 1, i));
    const p = points[current]!;
    const px = xs[current]!;
    const py = y(p.value);
    cross.setAttribute("x1", px.toFixed(1));
    cross.setAttribute("x2", px.toFixed(1));
    dot.setAttribute("cx", px.toFixed(1));
    dot.setAttribute("cy", py.toFixed(1));
    hover.setAttribute("visibility", "visible");
    tipValue.textContent = moneyCents(p.value);
    tipDate.textContent = longDate(p.date);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = Math.max(0, Math.min(width - tw, px - tw / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 14)}px`;
  };
  const hide = () => {
    current = -1;
    hover.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  const nearest = (clientX: number) => {
    const bx = svg.getBoundingClientRect().left;
    const px = clientX - bx;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - px) < Math.abs(xs[best]! - px)) best = i;
    return best;
  };

  const hit = svg.querySelector<SVGRectElement>(".chart__hit")!;
  hit.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerleave", () => {
    if (document.activeElement !== host) hide();
  });
  host.onfocus = () => show(current >= 0 ? current : points.length - 1);
  host.onblur = hide;
  host.onkeydown = (e) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 };
    if (e.key in moves) show((current < 0 ? points.length - 1 : current) + moves[e.key]!);
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(points.length - 1);
    else if (e.key === "Escape") hide();
    else return;
    e.preventDefault();
  };
}
