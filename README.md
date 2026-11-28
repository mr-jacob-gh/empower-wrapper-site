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
localStorage; unticked, it lasts until the tab closes). **Settings → Forget API key** (Settings in the
sidebar, or the cog at the end of the page switch on mobile) removes it after a confirmation. If the service
rejects a key, the page clears it and asks again.

### Settings

**Settings** (last in the sidebar; the cog at the end of the page switch on mobile) opens
`#/settings`:

- **Household details** is a form over the service's `/settings` store (`GET /settings` to fill it,
  `PATCH /settings` to save, so other keys are left alone). It has **Household income**
  (`householdIncome`, saved as a number, or `null` when blank) and **Addresses**
  (`zestimateAddresses`, a list of strings; **+ Add address** adds a row, × removes one). Blank rows
  are dropped and duplicates are refused. The service looks the addresses up daily on its own; the
  form never calls the paid `POST /zestimate/refresh`. **Loan interest rates**
  (`loanInterestRates`) has a % box per loan account, saved as `{"<userAccountId>": 6.25}`; blank
  boxes are left out, and rates saved for loans no longer listed are kept. To add a field, add it to `FIELDS` in
  `src/appsettings.ts`.
- **Reload data** re-reads the files the service has saved (no Empower call). The service updates
  them every 15 minutes on its own.
- **Refresh institutions** calls `POST /refresh-institutions` (add `?force=true` with the **Force
  refresh** box to include logins refreshed in the last hour). It asks Empower to pull new data from
  every bank and brokerage, then re-fetches every dataset, in the background. The status panel
  shows the last run (`GET /refresh-institutions`): state, outcome, times, schedule and each
  institution's result. **Check status** re-reads it; while a run is going the panel re-checks every
  5 seconds and reloads the data when it finishes. A `409` (a run already in progress) shows that
  run's progress instead.
- **Forget API key** removes the key from this browser, after a confirmation.

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
5-minute polling while the panel is open, and re-read on Reload data. Trend data is held **in memory
only**, for the open tab. It's never written to browser storage, the repo, GitHub or the service,
and it's dropped when you forget the API key.

## Available balance and credit

From the saved `accounts` dataset (read with the summary): cash (checking/savings) account rows
show only the **available balance** (`availableBalance`, what the bank says can be spent now). On
the account screen it's the main figure, with the regular balance in the details (they differ with
pending items or overdraft protection). Credit card rows keep the balance owed and show the
**available credit** (`availableCredit`) under it; the account screen lists it in its details. If
the accounts file can't be read, plain balances are shown. Tile and group totals stay
balance-based, so they match net worth.

## Debt-to-income

The Net worth card shows **Debt-to-income**: average monthly debt payments ÷ monthly gross income
(Settings → Household details → Household income, ÷ 12). Without an income it shows **Add income**,
linking to Settings. Click the figure for the breakdown (payments by source, income, months used).

Debt payments come from the saved transactions over the last 3 complete calendar months
(`src/dti.ts`):

- payments into linked loan and mortgage accounts (credits on loan accounts, recognised by
  `accountTypeGroup` or, when that's null as it is for some mortgages, `productType: "LOAN"`),
- payments into linked credit cards (credits on `CREDIT_CARD` accounts in a "credit card payment"
  category; other credits on a card are refunds and are left out), and
- money out of other accounts in a category whose name contains "mortgage", "loan" or "credit card
  payment" (Mortgages, Loans, Student Loans, Credit Card Payments, ...), for debts that aren't linked.

A payment seen on both sides (out of checking and into the linked loan or card, same amount within
5 days) counts once. Credit card payments are what was actually paid, often the full statement, so
the ratio can be higher than a lender's, which uses the minimum payment.

## Loan payoff estimates

Loan rows on the Summary page show **Est. payoff Mon YYYY**; the loan's account screen shows the
date, time left, and the payment and rate it used (`src/payoff.ts`).

- **Payments found:** money out of your other accounts (not loans or credit cards) that either
  mentions the loan's last digits (e.g. "…2328" from "Ending in 2328"), or is categorized as a
  mortgage payment (a loan payment, for other loans) and either it's your only loan of that kind or
  the description names the lender (e.g. "Coastal"). The loan's own transactions aren't used. The
  account screen lists the accounts the payments came from.
- **Payment:** the median of the monthly totals of those payments over the last 3 complete months
  (needs a payment in at least 2 of them). With a rate from Settings and balance history, the
  payment is principal + interest instead (how much the balance fell + that month's interest),
  which leaves out escrow.
- **Rate:** Settings → Household details → Loan interest rates, if entered. Otherwise estimated from
  the balance history: interest = payment − how much the balance fell, ÷ the balance at the start
  of the month. An estimate above 25% (likely escrow) isn't used; the screen asks for the rate.
- **Months left:** n = −ln(1 − r·B/P) / ln(1 + r), which accounts for more of each payment going to
  principal over time. A payment that doesn't cover the interest is flagged.

## Zestimate

The Net worth card also shows **Zestimate**: the total estimated value of the addresses in Settings →
Household details (`zestimateAddresses`), from `GET /zestimate`. That only reads the service's saved
lookups, so it never uses APIllow quota (`src/homevalue.ts`). A home listed for sale has no Zestimate,
so its list price is used. Click the figure for each address: value, change since the previous
lookup, rent estimate, when it was updated, and any lookup error. Addresses not looked up yet show
as **Pending** until the service's next daily run; addresses removed from the setting are left out.
Without any address it shows **Add address**, linking to Settings. The value is shown for reference
and isn't added to net worth.

## Sync warnings

Wherever an account's sync time is shown (the "Synced … ago" line on dashboard rows and
"Last synced" on the account screen), an amber warning icon appears in front of it when Empower
hasn't synced that account for more than 24 hours (`lastRefreshed` in the summary). Hovering or a
screen reader gives "Not synced in over 24 hours". The time comes from `lastRefreshed` in the
saved `accounts` dataset (when Empower last heard from the bank), falling back to the summary's copy,
which can lag behind.

Accounts Empower can't update until you reconnect them get an amber **Reconnect in Empower** flag
on their dashboard row (and an amber account icon), and a note on the account screen with the reason
and Empower's own message. This comes from the saved `accounts` dataset (`/data/accounts`, read with
the summary): an account needs reconnecting when it has an `aggregationError` (e.g.
`{"type": "MFA_REQUIRED"}`), `nextAction.nextActionLinkType` is `"RECONNECT"`, or
`nextAction.aggregationErrorType` is anything other than `"NO_ERROR"`. If that file can't be read,
the dashboard still shows, just without the flags.

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

## Spending

**Spending** in the sidebar (or the switch at the top on phones) opens `#/spending`: a donut of
where money went, with the total in the middle, for **Past week**, **Past month** (default),
**Past year** or **This year** (Jan 1 to date). Periods end on the transactions file's last day.
Hover a slice for its amount and share; pick a slice or its row in the legend to list its
transactions below (10 per page, newest first, expandable like on the account screen); pick it
again (or Clear) to deselect. The period and slice are kept in the URL
(`#/spending?range=year&slice=groceries`). Uses the saved `transactions` and `categories`; no
Empower calls.

Each spending transaction lands in one slice, checked in this order:
0. **Your merchant categories:** expand any transaction (on the Spending list or an account screen)
   and pick a **Spending category**. That applies to every transaction from the same merchant
   (`transactions[].merchantId`), from then on, whatever its category; pick **Automatic** to undo.
   It can also bring in something that otherwise isn't spending (e.g. a transfer). They're saved on
   your service (`/merchant-categories`, one merchant per `PUT`/`DELETE`, so two devices never
   overwrite each other) as the category's name (e.g. "Groceries/Household"), so they're the same
   on every device. The screen updates at once; if the save fails, the change is undone and the
   error shown. The Spending screen confirms how many transactions moved, with **Undo**, and lists
   all your merchant categories under the chart to change or remove (a name that isn't one of the
   six, set by another client, is listed but doesn't change the chart). Transactions without a
   merchant ID can't be assigned. The list is re-read every 5 minutes and on Reload data. Rules saved
   in the browser by the previous version are moved to the service once, matched to merchants
   through your transactions.
1. **Subscriptions:** charges belonging to a detected subscription (see below), including ones
   that have since ended, so past periods count them.
2. **Restaurants**, **Groceries/Household**, **Utilities** (Utilities, Cable/Satellite and Telephone), **Pets**
   (Pets/Pet Care), **Interest & Fees** (Service Charges/Fees, Advisory Fee, and money out in the
   Interest category, i.e. interest charged; interest earned isn't spending): by the category
   list's name for the transaction's `categoryId`.
3. **Other shopping:** every other Expense (or Uncategorized) transaction.

Spending is money out in the Expense group; transfers, card payments and income aren't spending.
Refunds (money in with an Expense category) reduce their slice. Slice colours are fixed per slice
and were validated in ring order (each against its neighbours, including the wrap-around pair) on
the dark card surface.

## Subscriptions

**Subscriptions** in the sidebar (or the Dashboard / Subscriptions switch at the top on phones)
opens `#/subscriptions`: totals (number active, ≈ per month, ≈ per year) and a unique list of active
subscriptions, sorted by name (A–Z) or by approximate next payment (soonest first) with the
switch above the list; the choice is kept in the URL (`#/subscriptions?sort=next`). Each shows its schedule, the account it's charged to,
the latest amount and an estimated next charge; selecting one expands it to list its charges (one
open at a time). It uses the saved `transactions` (last 12 months) and `categories`, already cached
for the account screen, so it makes no Empower calls.

How subscriptions are recognised (`src/subscriptions.ts`):
1. **Candidates:** money-out, non-duplicate charges in the Expense group (or Uncategorized).
   Transfers, card payments, income and retirement contributions drop out, and so do recurring bills
   that aren't subscriptions: Loans, Mortgages, Rent, Taxes, ATM/Cash, Checks, Wages Paid, Service
   Charges/Fees, Advisory Fee.
2. **Grouped by merchant across all accounts** (`merchantId`, or a cleaned-up description), so a
   subscription moved to another card stays one subscription.
3. **A regular schedule:** the typical gap picks weekly, every 2 weeks, monthly, every 2 / 3 / 6 months
   or yearly; at least 80% of gaps must fit it (one missed charge allowed); and there must be enough
   charges (4 weekly, 3 for every-2-weeks to every-2-months, 2 for quarterly and longer, which must
   then be the same amount; a new monthly one with 2 identical charges also counts).
4. **A steady price:** at most two changes of more than 3%, none over 35%, so price rises are
   followed (and shown) but variable spending like groceries or fuel isn't mistaken for a
   subscription.
5. **Several plans at one merchant:** if a merchant's charges don't fit as a whole, they're split by
   amount and each part is tested (e.g. two Apple plans).
6. **Active:** the last charge is no more than half a cycle overdue (at least 7 days' grace), measured
   from the transactions file's end date. Ended subscriptions aren't listed.

"Per month" converts each subscription's latest price to a monthly equivalent. Because the data
covers 12 months, a yearly subscription is only found if both renewals fall inside that window.

## Structure

```
src/
  api.ts        API client (X-API-Key; saved summary, accounts, performance, netWorthHistory, transactions,
                categories, cashFlowHistory; merchant categories GET/PUT/DELETE; refresh-institutions;
                settings GET/PATCH; zestimate)
  health.ts     Which accounts need reconnecting in Empower (from the accounts dataset)
  dti.ts        Debt-to-income: monthly loan, mortgage and credit card payments ÷ household income
  homevalue.ts  Zestimate on the Net worth card (saved lookups from GET /zestimate)
  payoff.ts     Loan payoff estimate: payment and rate from transactions, balance history and Settings
  auth.ts       Stores the API key in this browser only
  types.ts      Types for the API's summary and performance datasets
  dashboard.ts  Views: net worth, category tiles, account panels, trend pills, key prompt, errors
  account.ts    Account screen: details, paginated transactions, balance chart (investment-type only)
  chart.ts      Single-series SVG line chart with crosshair tooltip and keyboard stepping
  cache.ts      In-memory, per-tab cache for saved datasets
  categories.ts Transaction category grouping (Income/Expenses/Transfers/Uncategorized) and filtering
  filterbox.ts  The transactions filter box: grouping list + free-text search (ARIA combobox)
  subscriptions.ts Recurring-charge detection and the Subscriptions screen
  spending.ts   Spending slices, periods, totals, donut and legend
  rules.ts      Your merchant categories (by merchantId), saved on the service
  trends.ts     24h / 90-day investment trends from the saved performance file, in-memory cache
  settings.ts   Settings screen: reload data, refresh institutions + status panel, forget API key
  appsettings.ts Settings → Household details form (fields saved to the service's /settings)
  confirm.ts    Themed confirmation dialog (native <dialog>)
  main.ts       App shell, nav, key prompt flow, reload + 5-minute polling, routing + screen transitions
  config.ts     Personal settings (emergency fund account and monthly expenses)
  format.ts     Currency, percent and relative-time formatting
  icons.ts      Inline SVG icons
  styles.css    Theme (deep navy, glass-edged panels, electric blue accent) and responsive layout
```
