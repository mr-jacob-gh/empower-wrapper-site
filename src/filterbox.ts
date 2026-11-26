// Transactions filter: one text box that is also a list of the main groupings.
// Picking an option (All transactions, Income, Expenses, Transfers, Uncategorized)
// filters by group; typing filters on the transaction's fields instead.
// Follows the ARIA combobox pattern (list autocomplete, aria-activedescendant).

import { ALL, type Selection } from "./categories";
import { esc } from "./format";
import { icons } from "./icons";

export interface FilterState {
  /** A grouping (or ALL). Ignored while `query` is set. */
  category: Selection;
  /** Free text, matched against the transaction's fields. */
  query: string;
}

export interface BoxOption {
  value: Selection;
  label: string;
  /** Shown after the label; null when unknown. */
  count: number | null;
}

const SEARCH = "__search";
const LIST_ID = "txn-filter-list";
const count = new Intl.NumberFormat("en-US");

export function filterBoxHtml(): string {
  return `
    <div class="txn-filter" data-role="txn-filter">
      <span class="txn-filter__icon" aria-hidden="true">${icons.search}</span>
      <input class="txn-filter__input" type="text" role="combobox" autocomplete="off" spellcheck="false"
        aria-label="Filter transactions: pick a grouping or type to search" aria-autocomplete="list"
        aria-expanded="false" aria-controls="${LIST_ID}" placeholder="All transactions" />
      <button type="button" class="txn-filter__btn" data-role="clear" aria-label="Clear filter" hidden>${icons.close}</button>
      <button type="button" class="txn-filter__btn" data-role="toggle" tabindex="-1" aria-label="Show groupings">${icons.chevronDown}</button>
      <ul class="txn-filter__list" id="${LIST_ID}" role="listbox" aria-label="Groupings" hidden>
        <li role="option" id="${LIST_ID}-search" data-value="${SEARCH}" class="txn-filter__search" hidden></li>
        <li role="presentation" data-role="options"></li>
      </ul>
    </div>`;
}

interface Box {
  input: HTMLInputElement;
  list: HTMLUListElement;
  search: HTMLLIElement;
  optionsHost: HTMLLIElement;
  clear: HTMLButtonElement;
  state: FilterState;
  labels: Map<Selection, string>;
  active: number;
  timer: number | undefined;
}

const boxes = new WeakMap<HTMLElement, Box>();

/** Wire up a filter box once, right after its markup is inserted. */
export function mountFilterBox(el: HTMLElement, initial: FilterState, onChange: (s: FilterState) => void): void {
  const box: Box = {
    input: el.querySelector<HTMLInputElement>(".txn-filter__input")!,
    list: el.querySelector<HTMLUListElement>(".txn-filter__list")!,
    search: el.querySelector<HTMLLIElement>(".txn-filter__search")!,
    optionsHost: el.querySelector<HTMLLIElement>("[data-role='options']")!,
    clear: el.querySelector<HTMLButtonElement>("[data-role='clear']")!,
    state: { ...initial },
    labels: new Map([[ALL, "All transactions"]]),
    active: -1,
    timer: undefined,
  };
  boxes.set(el, box);
  const { input, list } = box;

  const options = () => [...list.querySelectorAll<HTMLLIElement>("[role='option']:not([hidden])")];
  const setActive = (i: number) => {
    const opts = options();
    box.active = opts.length ? (i + opts.length) % opts.length : -1;
    opts.forEach((o, k) => o.classList.toggle("is-active", k === box.active));
    const cur = opts[box.active];
    if (cur) {
      input.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const open = () => {
    if (!list.hidden) return;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    // Start on the current choice (or the search line while typing).
    const opts = options();
    const cur = box.state.query ? 0 : opts.findIndex((o) => o.dataset.value === box.state.category);
    setActive(cur);
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    box.active = -1;
  };
  const emit = (next: FilterState) => {
    window.clearTimeout(box.timer);
    box.timer = undefined; // nothing pending any more
    box.state = next;
    paint(box);
    onChange({ ...next });
  };
  const choose = (value: string | undefined) => {
    if (!value) return;
    close();
    if (value === SEARCH) {
      emit({ category: ALL, query: input.value.trim() });
      return;
    }
    input.value = value === ALL ? "" : (box.labels.get(value) ?? "");
    box.search.hidden = true;
    emit({ category: value, query: "" });
    input.select();
  };

  input.addEventListener("focus", () => {
    // In group mode the box shows the group's name: select it so typing replaces it.
    if (!box.state.query && box.state.category !== ALL) input.select();
  });
  input.addEventListener("click", open);
  // While a grouping is shown, typing starts a new search instead of editing its name,
  // and deleting clears it.
  input.addEventListener("beforeinput", (e) => {
    const showingGroup = !box.state.query && box.state.category !== ALL && box.timer === undefined;
    if (!showingGroup || input.value !== (box.labels.get(box.state.category) ?? "")) return;
    if (e.inputType.startsWith("delete")) {
      e.preventDefault();
      input.value = "";
      emit({ category: ALL, query: "" });
      open();
    } else if (e.inputType.startsWith("insert")) {
      input.value = "";
    }
  });
  input.addEventListener("input", () => {
    const text = input.value;
    box.search.hidden = text.trim() === "";
    box.search.innerHTML = `${icons.search}<span>Search all fields for “<strong>${esc(text.trim())}</strong>”</span>`;
    open();
    setActive(0);
    box.clear.hidden = text === "";
    window.clearTimeout(box.timer);
    box.timer = window.setTimeout(() => emit({ category: ALL, query: text.trim() }), 150);
  });
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        if (list.hidden) open();
        else setActive(box.active + 1);
        break;
      case "ArrowUp":
        if (list.hidden) open();
        else setActive(box.active - 1);
        break;
      case "Home":
      case "End":
        if (list.hidden) return;
        setActive(e.key === "Home" ? 0 : options().length - 1);
        break;
      case "Enter":
        if (!list.hidden && box.active >= 0) choose(options()[box.active]?.dataset.value);
        else if (box.timer !== undefined) choose(SEARCH);
        else close();
        break;
      case "Escape":
        if (!list.hidden) close();
        else if (box.state.query || box.state.category !== ALL || input.value) {
          input.value = "";
          box.search.hidden = true;
          emit({ category: ALL, query: "" });
        } else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  input.addEventListener("blur", () => {
    close();
    // Leaving with a search still pending: apply it now rather than after the debounce.
    if (box.timer !== undefined) emit({ category: ALL, query: input.value.trim() });
    paint(box);
  });

  // Keep focus in the input while using the list or buttons with the mouse.
  el.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest(".txn-filter__list, .txn-filter__btn")) e.preventDefault();
  });
  list.addEventListener("click", (e) => choose((e.target as Element).closest<HTMLElement>("[role='option']")?.dataset.value));
  el.querySelector("[data-role='toggle']")!.addEventListener("click", () => {
    input.focus();
    if (list.hidden) open();
    else close();
  });
  box.clear.addEventListener("click", () => {
    input.value = "";
    box.search.hidden = true;
    emit({ category: ALL, query: "" });
    input.focus();
    open();
  });

  paint(box);
}

/** Refresh the grouping options (counts change with the data) and the shown state. */
export function updateFilterBox(el: HTMLElement, opts: BoxOption[], state: FilterState): void {
  const box = boxes.get(el);
  if (!box) return;
  box.state = { ...state };
  box.labels = new Map(opts.map((o) => [o.value, o.label]));
  box.optionsHost.outerHTML = `<li role="presentation" data-role="options" class="txn-filter__group"><ul role="group" aria-label="Groupings">${opts
    .map(
      (o) => `<li role="option" id="${LIST_ID}-${esc(o.value)}" data-value="${esc(o.value)}" aria-selected="${!state.query && o.value === state.category}"
        class="${o.count === 0 ? "is-empty" : ""}"><span>${esc(o.label)}</span>${o.count === null ? "" : `<span class="txn-filter__count">${count.format(o.count)}</span>`}</li>`,
    )
    .join("")}</ul></li>`;
  box.optionsHost = el.querySelector<HTMLLIElement>("[data-role='options']")!;
  paint(box);
}

/** Show the current state in the input (never while it has focus: the user may be typing). */
function paint(box: Box): void {
  const { input, state } = box;
  if (document.activeElement !== input) {
    input.value = state.query || (state.category === ALL ? "" : (box.labels.get(state.category) ?? ""));
    if (!state.query) box.search.hidden = true;
  }
  box.clear.hidden = input.value === "" && !state.query && state.category === ALL;
  for (const o of box.list.querySelectorAll<HTMLElement>("[data-value]")) {
    if (o.dataset.value !== SEARCH) o.setAttribute("aria-selected", String(!state.query && o.dataset.value === state.category));
  }
}
