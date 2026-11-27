// The "Household details" panel on the Settings screen: a form over the service's
// generic /settings store. To add a setting, add an entry to FIELDS.

import { esc } from "./format";
import { icons } from "./icons";
import type { Setting } from "./types";

type FieldKind = "money" | "text" | "list" | "rates";

interface FieldDef {
  /** The /settings key (letters, digits, . _ - only). */
  key: string;
  kind: FieldKind;
  label: string;
  help?: string;
  placeholder?: string;
  /** list: name of one item, for "Add address" / "Address 2" / "Remove address 2". */
  item?: string;
}

/** Things the form needs from the rest of the app: the loan accounts, for the interest-rate rows. */
export interface AppContext {
  loans: { id: string; name: string; firm: string }[];
}

/** rates: annual percentage per loan account, keyed by userAccountId (as a string). */
export type Rates = Record<string, number>;

export const FIELDS: readonly FieldDef[] = [
  {
    key: "householdIncome",
    kind: "money",
    label: "Household income",
    help: "Total yearly income before taxes.",
    placeholder: "185,000",
  },
  {
    key: "zestimateAddresses",
    kind: "list",
    label: "Addresses",
    item: "address",
    placeholder: "1 Main St, Raleigh, NC 27601",
    help:
      'Properties to track with Zillow Zestimates, written as "street, city, state ZIP". The service looks each one up once a day, which uses one lookup from your APIllow plan per address.',
  },
  {
    key: "loanInterestRates",
    kind: "rates",
    label: "Loan interest rates",
    placeholder: "6.25",
    help: "The annual interest rate on each loan, from your loan statement. Leave blank if you don't know it.",
  },
];

const MAX_RATE = 30;

/** Form values by key: money → number | null, text → string, list → string[], rates → Rates. */
export type AppValues = Record<string, number | string | string[] | Rates | null>;

/** Same keys in the same order, so saved and edited values compare equal. */
const sortedRates = (r: Rates): Rates => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

const parseRate = (s: string): number | null => {
  const cleaned = s.replace(/[%\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

// ---------- Saved settings → form values ----------

const parseMoney = (s: string): number | null => {
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

function fromSaved(field: FieldDef, value: unknown): AppValues[string] {
  switch (field.kind) {
    case "money":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const n = parseMoney(value);
        return n !== null && !Number.isNaN(n) ? n : null;
      }
      return null;
    case "text":
      return typeof value === "string" ? value : value == null ? "" : String(value);
    case "list":
      if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    case "rates": {
      const out: Rates = {};
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
          const n = typeof v === "number" ? v : typeof v === "string" ? parseRate(v) : null;
          if (n !== null && Number.isFinite(n)) out[id] = n;
        }
      }
      return sortedRates(out);
    }
  }
}

export function valuesFromSettings(list: Setting[]): AppValues {
  const byKey = new Map(list.map((s) => [s.key, s.value]));
  return Object.fromEntries(FIELDS.map((f) => [f.key, fromSaved(f, byKey.get(f.key))]));
}

/** For change detection. */
export const sameValues = (a: AppValues, b: AppValues): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------- Rendering ----------

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function listRowHtml(f: FieldDef, value: string, index: number, total: number): string {
  const n = index + 1;
  const item = f.item ?? "item";
  return `
    <div class="list-row">
      <input class="input" type="text" name="${f.key}" value="${esc(value)}" placeholder="${esc(f.placeholder ?? "")}"
        aria-label="${esc(cap(item))} ${n}" autocomplete="off" spellcheck="false" />
      <button type="button" class="icon-btn icon-btn--sm icon-btn--remove" data-list-remove
        aria-label="Remove ${esc(item)} ${n}" title="Remove ${esc(item)}"${total === 1 && !value ? " hidden" : ""}>${icons.close}</button>
    </div>`;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const pct = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function ratesHtml(f: FieldDef, value: AppValues[string], ctx: AppContext, describedBy: string, error: string, help: string): string {
  const rates = value && typeof value === "object" && !Array.isArray(value) ? (value as Rates) : {};
  const rows = ctx.loans.length
    ? ctx.loans
        .map((loan) => {
          const inputId = `app-${f.key}-${loan.id}`;
          const v = rates[loan.id];
          return `
          <div class="rate-row">
            <label class="rate-row__name" for="${inputId}">${esc(loan.name)}${loan.firm ? `<small>${esc(loan.firm)}</small>` : ""}</label>
            <div class="pct">
              <input class="input" id="${inputId}" type="text" name="${f.key}" data-loan-id="${esc(loan.id)}"
                value="${typeof v === "number" ? esc(pct.format(v)) : ""}" placeholder="${esc(f.placeholder ?? "")}"
                inputmode="decimal" autocomplete="off" aria-describedby="${describedBy}" />
              <span class="pct__sym" aria-hidden="true">%</span>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="app-field__empty">No loan accounts found.</p>`;
  return `
    <fieldset class="app-field" data-field="${f.key}" aria-describedby="${describedBy}">
      <legend class="app-field__label">${esc(f.label)}</legend>
      <div class="app-field__control">
        <div class="rate-rows">${rows}</div>
        ${error}${help}
      </div>
    </fieldset>`;
}

function fieldHtml(f: FieldDef, value: AppValues[string], ctx: AppContext): string {
  const id = `app-${f.key}`;
  const help = f.help ? `<p class="app-field__help" id="${id}-help">${esc(f.help)}</p>` : "";
  const error = `<p class="field-error" data-error-for="${f.key}" id="${id}-error" hidden></p>`;
  const describedBy = `${f.help ? `${id}-help ` : ""}${id}-error`;

  if (f.kind === "rates") return ratesHtml(f, value, ctx, describedBy, error, help);

  if (f.kind === "list") {
    const items = Array.isArray(value) && value.length ? value : [""];
    return `
      <fieldset class="app-field" data-field="${f.key}" aria-describedby="${describedBy}">
        <legend class="app-field__label">${esc(f.label)}</legend>
        <div class="app-field__control">
          <div class="list-rows" data-list="${f.key}">
            ${items.map((v, i) => listRowHtml(f, v, i, items.length)).join("")}
          </div>
          <button type="button" class="btn btn--ghost btn--sm list-add" data-list-add="${f.key}">${icons.plus}<span>Add ${esc(f.item ?? "item")}</span></button>
          ${error}${help}
        </div>
      </fieldset>`;
  }

  const shown = f.kind === "money" ? (typeof value === "number" ? usd.format(value) : "") : typeof value === "string" ? value : "";
  const input = `<input class="input" id="${id}" type="text" name="${f.key}" value="${esc(shown)}"
      placeholder="${esc(f.placeholder ?? "")}" aria-describedby="${describedBy}"
      ${f.kind === "money" ? `inputmode="decimal" autocomplete="off" data-money` : ""} />`;
  return `
    <div class="app-field" data-field="${f.key}">
      <label class="app-field__label" for="${id}">${esc(f.label)}</label>
      <div class="app-field__control">
        ${f.kind === "money" ? `<div class="money"><span class="money__sym" aria-hidden="true">$</span>${input}</div>` : input}
        ${error}${help}
      </div>
    </div>`;
}

export function appFieldsHtml(values: AppValues, ctx: AppContext): string {
  return FIELDS.map((f) => fieldHtml(f, values[f.key] ?? null, ctx)).join("");
}

export function appSettingsCardHtml(): string {
  return `
    <section class="card setting setting--stack" aria-labelledby="set-app">
      <div class="setting__text">
        <h2 class="setting__title" id="set-app">Household details</h2>
        <p class="setting__desc">Saved on the service, so they're the same on every device.</p>
      </div>
      <form class="app-form" data-form="app-settings" novalidate>
        <div class="app-fields" data-role="app-fields"><div class="skeleton skeleton--form" aria-busy="true" aria-label="Loading"></div></div>
        <div class="app-form__foot">
          <span class="app-form__state" data-role="app-state" aria-live="polite"></span>
          <button type="submit" class="btn btn--accent" data-role="app-save" disabled>Save settings</button>
        </div>
      </form>
    </section>`;
}

/** A new empty row for a list field (after the + button). */
export function newListRowHtml(key: string, index: number): string {
  const f = FIELDS.find((x) => x.key === key);
  return f ? listRowHtml(f, "", index, index + 1) : "";
}

/** Renumber a list's aria labels and show/hide remove buttons after adding or removing rows. */
export function relabelList(list: HTMLElement): void {
  const f = FIELDS.find((x) => x.key === list.dataset.list);
  const item = f?.item ?? "item";
  const rows = [...list.querySelectorAll<HTMLElement>(".list-row")];
  rows.forEach((row, i) => {
    const input = row.querySelector("input")!;
    const btn = row.querySelector<HTMLButtonElement>("[data-list-remove]")!;
    input.setAttribute("aria-label", `${cap(item)} ${i + 1}`);
    btn.setAttribute("aria-label", `Remove ${item} ${i + 1}`);
    btn.hidden = rows.length === 1 && !input.value;
  });
}

// ---------- Reading the form ----------

export interface ReadResult {
  values: AppValues;
  /** Message per field key. */
  errors: Record<string, string>;
}

/**
 * `saved`: what's saved now. Rates for loans not shown in the form (e.g. an account that's gone
 * from the summary) are kept, so saving doesn't silently drop them.
 */
export function readAppForm(form: HTMLFormElement, saved: AppValues | null): ReadResult {
  const values: AppValues = {};
  const errors: Record<string, string> = {};
  for (const f of FIELDS) {
    const inputs = [...form.querySelectorAll<HTMLInputElement>(`[name="${f.key}"]`)];
    if (f.kind === "rates") {
      const shown = new Set(inputs.map((i) => i.dataset.loanId ?? ""));
      const prev = saved?.[f.key];
      const rates: Rates = {};
      if (prev && typeof prev === "object" && !Array.isArray(prev)) {
        for (const [id, v] of Object.entries(prev as Rates)) if (!shown.has(id)) rates[id] = v;
      }
      for (const input of inputs) {
        const n = parseRate(input.value);
        if (n === null) continue;
        if (Number.isNaN(n) || n < 0 || n > MAX_RATE) {
          errors[f.key] = `Enter a rate between 0 and ${MAX_RATE}, like 6.25.`;
          // Keep what was typed so it counts as a change (Save enables and shows this error).
          (rates as Record<string, unknown>)[input.dataset.loanId ?? ""] = input.value.trim();
          continue;
        }
        rates[input.dataset.loanId ?? ""] = n;
      }
      values[f.key] = sortedRates(rates);
    } else if (f.kind === "money") {
      const n = parseMoney(inputs[0]?.value ?? "");
      const bad = Number.isNaN(n) || (n !== null && n < 0);
      if (bad) errors[f.key] = "Enter an amount, like 185,000.";
      // An invalid entry is kept as typed so it counts as a change (Save enables and shows the error).
      values[f.key] = bad ? (inputs[0]?.value ?? "").trim() : n;
    } else if (f.kind === "text") {
      values[f.key] = (inputs[0]?.value ?? "").trim();
    } else {
      const items = inputs.map((i) => i.value.trim().replace(/\s+/g, " ")).filter(Boolean);
      const seen = new Set<string>();
      const dupe = items.find((v) => {
        const k = v.toLowerCase();
        if (seen.has(k)) return true;
        seen.add(k);
        return false;
      });
      if (dupe) errors[f.key] = `"${dupe}" is listed more than once.`;
      values[f.key] = items;
    }
  }
  return { values, errors };
}

/** The body for PATCH /settings. An empty money field is saved as null ("not set"). */
export const settingsFromValues = (values: AppValues): Setting[] => FIELDS.map((f) => ({ key: f.key, value: values[f.key] ?? null }));
