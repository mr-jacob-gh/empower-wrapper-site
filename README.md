# Empower Wrapper Site

A static dashboard (plain TypeScript + Vite, no framework) for the Empower Local Service
described in [`openapi.yaml`](./openapi.yaml). It's built for GitHub Pages and reads your data
straight from the service in your browser, so nothing financial is stored in the repo or on GitHub.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

In dev, requests to `/api/*` are proxied to the service at
`https://beefjerky67.asuscomm.com:44300`, so no CORS setup is needed for dev. Set
`EMPOWER_DEV_TARGET` to proxy somewhere else.

Other scripts: `npm run build` (typecheck + build to `dist/`), `npm run preview`, `npm run typecheck`.

## Deploy to GitHub Pages

1. Push to the `main` branch.
2. Once, in the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml` and publishes `dist/`.

The deployed site calls `https://beefjerky67.asuscomm.com:44300` (override at build time with
`VITE_API_BASE`).

## Connecting to the service

### API key

The page asks for an API key (from the service's `data/api-keys.txt`) and sends it as
`X-API-Key`. The key is **never in the code or the repo**: anything in a GitHub Pages build is
public. It's stored only in the browser you enter it in ("Remember on this device" uses
localStorage; unticked, it lasts until the tab closes). **Forget API key** (sidebar, or the
top-right icon on mobile) removes it. If the service rejects a key, the page clears it and asks again.

Note: every Pages site under `https://<user>.github.io` shares one origin, so your other Pages
sites could read a remembered key. Untick "Remember" if that matters.

### Certificate

The service uses a Let's Encrypt certificate for `beefjerky67.asuscomm.com`, which every
browser and phone already trusts, so there's nothing to install on any device. Let's Encrypt
certificates last 90 days; if renewal ever fails, the dashboard will show "Can't reach your
service" and `https://beefjerky67.asuscomm.com:44300/status` will show a certificate warning.

### CORS on the service

The browser sends a CORS preflight (`OPTIONS`) before each call because of the `X-API-Key`
header. The service must:

- answer `OPTIONS` **without** requiring the API key, with
  `Access-Control-Allow-Origin: https://<user>.github.io`,
  `Access-Control-Allow-Headers: X-API-Key, Authorization` and
  `Access-Control-Allow-Methods: GET, POST`;
- include `Access-Control-Allow-Origin` on every response, **including 401s** (otherwise the
  page sees a network error instead of "wrong key").

Use your exact Pages origin rather than `*`.

## Investment trends

Selecting the **Investments** tile shows a 24-hour and a 90-day trend on each investment,
retirement, ESOP and ESPP account: the market gain/loss in dollars, **excluding deposits and
withdrawals**, and that as a percent of the balance at the start of the period.

Both come straight from `accountSummaries` in the **saved** `GET /data/performance` file, whose
default range is the last 90 days: `oneDayPerformanceValueChange` for 24h and
`dateRangePerformanceValueChange` for 90d. Hovering over the 90d figure shows the exact dates the
file covers. It's a file read on the service, not an Empower call, so it's fast and works even
when the Empower session has ended.

The file is read when you open the Investments panel, reused for 5 minutes, re-read with the
5-minute polling while the panel is open, and re-read on Refresh. Trend data is held **in memory
only**, for the open tab. It's never written to browser storage, the repo, GitHub or the service,
and it's dropped when you forget the API key.

## Account screen

Selecting any account under the Cash, Investments, Credit cards or Loans tiles (anywhere on its
row) opens its own screen at `#/account/<userAccountId>`, so the browser's back button and deep links work. On
phones the dashboard slides off to the left as the account slides in from the right, and the
reverse on **Back to summary**; on wider screens it's a short fade. Returning puts you back where
you were on the dashboard.

The screen shows the account's details (credit cards also show the credit limit and available
credit) and its transactions, 10 per page. Investment, retirement, ESOP and ESPP accounts also
show their 24h / 90d trends and a balance chart; cash, credit card and loan accounts don't. Everything comes from saved files (no Empower calls), kept in memory
for 5 minutes and never stored anywhere else:

- **Balance chart:** `GET /data/netWorthHistory` (daily balance for every account, last year),
  filtered to the account. **90d** plots the last 90 days; **24h** compares the last two daily
  balances, since the service has no intraday data. Balances include deposits and withdrawals
  (unlike the 24h/90d pills, which are market gain/loss). Hover or use the arrow keys for each
  day's value; **Show values** lists them all.
- **Transactions:** `GET /data/transactions`, filtered to the account (duplicates dropped),
  newest first and grouped by month. The saved file covers the **last 12 months**.
- **Transaction details:** click (or Enter/Space on) a transaction to expand it and see every field
  it has, labelled (the category is shown from the category list, with its group). Opening one
  closes any other; clicking an open one closes it. Changing page or filter closes it too.
- **Filter:** one box on the transactions card that is both a list and a search field.
  - **Pick a grouping** from its list: **All transactions** (default), **Income**, **Expenses**,
    **Transfers** or **Uncategorized**, each with its count for this account's loaded transactions
    (zero counts are greyed but selectable). A transaction's group is the `type` of its category in
    `GET /data/categories` (fetched once per page load), looked up by `categoryId`; the
    transaction's own `categoryName` and `categoryType` are never used for this. Uncategorized also
    catches transactions whose `categoryId` isn't in the list (each is logged to the console).
  - **Or type** to search every text and number field of the transaction, plus the date and amount
    as shown, and the category's name and group. Several words must all match. ID fields
    (`userTransactionId`, `accountId`, …) are left out so numbers don't match by accident.
  - Arrow keys, Enter and Escape work as in any combobox; Escape (or ×) clears the filter.
  - The count badge and money in/out totals follow the filter, and it's kept in the URL
    (`#/account/<id>?category=EXPENSE` or `?q=whole foods`). If the category list can't be loaded,
    searching still works but the groupings aren't offered.

## Structure

```
src/
  api.ts        API client (X-API-Key; saved summary, performance, netWorthHistory, transactions,
                categories, cashFlowHistory)
  auth.ts       Stores the API key in this browser only
  types.ts      Types for the API's summary and performance datasets
  dashboard.ts  Views: net worth, category tiles, account panels, trend pills, key prompt, errors
  account.ts    Account screen: details, paginated transactions, balance chart (investment-type only)
  chart.ts      Single-series SVG line chart with crosshair tooltip and keyboard stepping
  cache.ts      In-memory, per-tab cache for saved datasets
  categories.ts Transaction category grouping (Income/Expenses/Transfers/Uncategorized) and filtering
  filterbox.ts  The transactions filter box: grouping list + free-text search (ARIA combobox)
  trends.ts     24h / 90-day investment trends from the saved performance file, in-memory cache
  main.ts       App shell, key prompt flow, refresh + 5-minute polling, routing + screen transitions
  config.ts     Personal settings (emergency fund account and monthly expenses)
  format.ts     Currency, percent and relative-time formatting
  icons.ts      Inline SVG icons
  styles.css    Theme (dark slate, mint accent) and responsive layout
```
