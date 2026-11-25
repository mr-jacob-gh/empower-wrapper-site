const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** $12,345 */
export const money = (n: number): string => usd0.format(n);

/** $12,345.67 */
export const moneyCents = (n: number): string => usd2.format(n);

/** Split "$12,345.67" into ["$12,345", ".67"] so cents can be styled smaller. */
export function moneyParts(n: number): [string, string] {
  const s = usd2.format(n);
  const i = s.lastIndexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i)];
}

/** 0.123 -> "12.3%" */
export const percent = (fraction: number): string => pct.format(fraction);

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "4 minutes ago", "yesterday", ... */
export function timeAgo(date: Date, now = Date.now()): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

export const dateTime = (d: Date): string =>
  d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Escape text for safe interpolation into HTML. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
