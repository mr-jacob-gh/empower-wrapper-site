# Empower Wrapper Site

A static dashboard (plain TypeScript + Vite, no framework) for the Empower Local Service
described in [`openapi.yaml`](./openapi.yaml). It's built for GitHub Pages and reads your data
straight from the service on your own PC, so nothing financial is stored in the repo or on GitHub.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

In dev, requests to `/api/*` are proxied to `http://localhost:5055`, so it works even before the
service sends CORS headers.

Other scripts: `npm run build` (typecheck + build to `dist/`), `npm run preview`, `npm run typecheck`.

## Deploy to GitHub Pages

1. Push to a GitHub repo on the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml` and publishes `dist/`.

The build uses relative paths, so it works at `https://<user>.github.io/<repo>/` without config.

## Connecting the deployed site to the service

The deployed page calls `http://localhost:5055` from your browser. Two things must allow that:

- **CORS on the service.** Responses must include
  `Access-Control-Allow-Origin: https://<user>.github.io`.
  Use that exact origin rather than `*`: with `*`, any website you visit could read your
  financial data while the service is running.
- **Browser permission.** Chrome and Edge ask once before a public website can reach `localhost`
  ("local network access"); allow it for your Pages site. Safari may block `http://localhost`
  from an `https` page entirely.

To point the build at a different address, set `VITE_API_BASE` (for example in `.env.local`).

> The mobile layout works in any narrow window, but a phone can't reach `localhost` on your PC.
> Using it from a phone would need the service exposed on your network (with HTTPS), which this
> project doesn't set up.

## Structure

```
src/
  api.ts        API client (GET /data/summary, Last-Modified → "saved x ago")
  types.ts      Types for the API's summary dataset
  dashboard.ts  Dashboard HTML: net worth, category totals, accounts
  main.ts       App shell, loading/error states, refresh + 5-minute polling
  format.ts     Currency, percent and relative-time formatting
  icons.ts      Inline SVG icons
  styles.css    Theme (dark slate, mint accent) and responsive layout
```
