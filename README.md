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

## Structure

```
src/
  api.ts        API client (X-API-Key, GET /data/summary, Last-Modified → "last fetched")
  auth.ts       Stores the API key in this browser only
  types.ts      Types for the API's summary dataset
  dashboard.ts  Views: net worth, category tiles, account panels, key prompt, errors
  main.ts       App shell, key prompt flow, refresh + 5-minute polling
  config.ts     Personal settings (emergency fund account and monthly expenses)
  format.ts     Currency, percent and relative-time formatting
  icons.ts      Inline SVG icons
  styles.css    Theme (dark slate, mint accent) and responsive layout
```
