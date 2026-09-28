# App documentation

## Overview
Notes for working on the React app, the web UI served by the Pod for
temperature, schedules, settings, and sleep data. It covers running the app
against a Pod or against mocked data, building it, and how the code is
organized.

The app uses the server's REST API and WebSocket stream. It is built with
Vite and uses Material UI for components and theming, React Query for server
data, and Zustand for a small amount of client state.

## Developing
Run `npm install` in `app/` and in `server/`. The app imports some schema
files directly from `server/src/`, and those need the server's dependencies.

### Against a Pod
Start Vite with your Pod's IP address:

```bash
VITE_POD_IP=192.168.1.50 npm run dev
```

`npm run dev` sets `VITE_ENV=dev`. In that mode axios sends API requests, and
the app opens its WebSocket, to `http://<VITE_POD_IP>:3000` instead of the
page's own origin (see [src/api/api.ts](src/api/api.ts)). Vite serves on
port 5173 on all interfaces, so a phone on the same network can load it.

The server only accepts cross-origin requests from `localhost` and from its
own local subnets. If your browser reaches Vite from another address (for
example over Tailscale), set `ALLOWED_ORIGIN` in the server's environment.

To change the server at the same time, run it in hot reload mode on the Pod:
[server/README_SERVER.md](../server/README_SERVER.md#hot-reloading-on-the-pod).

### Without a Pod (demo mode)
```bash
VITE_ENV=demo npx vite
```

This runs the app against mocked data from
[Mock Service Worker](https://mswjs.io/) (`src/mocks/`). No Pod or server is
needed. The [live demo](https://ltimothy.github.io/nightstand/) is the same
build.

## Building
- `npm run build` (and `npm run build:pr`, which differs only in `VITE_ENV`)
  typechecks and writes the bundle to `../server/public/`, which the server
  serves. [CONTRIBUTING.md](../CONTRIBUTING.md) covers when to rebuild and
  commit it.
- `npm run build:demo` writes the demo build to `app/dist/`.

## Tests
- `npm test` runs the unit and component tests (Vitest). See
  [src/test/README.md](src/test/README.md) for the test harness.
- `e2e/` holds Playwright tests that run against the demo build. Run
  `npm run build:demo` first, then `npx playwright test`.
- `npm run lint` runs ESLint.

---

## Code layout (`src/`)

- `main.tsx`: Entry point. Sets up the providers (React Query, theme, date
  localization, `AppStoreProvider`, router) and renders `AppRoutes`. In demo
  mode it starts the mock service worker first.
- `AppRoutes.tsx`: Routes. Each page is lazy-loaded. To add a page, add a
  lazy import and a route here.
- `state/appStore.tsx`: Zustand store with the selected side (saved in
  `localStorage`) and an `isUpdating` flag that controls set while a change
  is in flight. `AppStoreProvider` also opens the app's single WebSocket
  connection and sets the default time zone from settings.
- `api/`: One file per server resource, with its React Query hooks, plus
  `api.ts` (the axios instance) and `eventStream.ts` (the WebSocket client).
  Schemas that must match the server re-export the server's own files, for
  example `settingsSchema.ts` re-exports `server/src/db/settingsSchema.ts`.
- `components/`: Shared components. `Layout` renders the current page and the
  `Navbar`, which is a bottom navigation bar on narrow screens and a top app
  bar on wide ones. The navbar hides the Elevation tab when no adjustable base
  is configured and shows "Reconnecting" while the WebSocket is down. The
  sleep and vitals chart and card components are here too.
- `design/`: Shared visual building blocks and design tokens.
- `lib/`: Plain helper functions (temperature conversion, bed geometry,
  formatting).
- `pages/`:
  - **ControlTempPage**: Temperature slider, power button, and away-mode and
    alarm notices.
  - **BaseControlPage**: Adjustable base position (Pod 4 and later).
  - **SchedulePage**: Daily power, temperature, and alarm schedules, with
    copy to other days.
  - **DataPage**: Sleep, vitals, and logs tabs. The changelog page is in the
    same folder.
  - **SettingsPage**: Device and per-side settings, priming, storage and
    memory usage, and the versions and update screen.
  - **StatusPage**: Health of each server-side service.
  - `PageContainer.tsx`: Standard wrapper for page content.
- `mocks/`: Request handlers and data for demo mode.
- `test/`: Test setup and render helpers.

---

## Data flow
- **React Query** fetches and caches server data. Requests go through the
  axios instance in `api/api.ts`.
- **WebSocket** (`api/eventStream.ts`): a `device-status` message is written
  directly into the React Query cache. `service-health` and `job-event`
  messages mark the related queries stale so they refetch. While the socket
  is down, the client reconnects with exponential backoff (up to 30 seconds)
  and each hook falls back to its own polling interval.
- **Zustand** holds the client-only state described above.

## Error handling
- If device status fails to load, the temperature page shows a "Try again"
  button.
- The server validates schedule saves against the shared Zod schemas (for
  example, temperatures from 55 to 110°F). If a save fails, the schedule page
  keeps your edit so you can try again.

---

## License
The app is released under the MIT License, with a disclaimer. See
[LICENSE.md](../LICENSE.md). The settings page shows the license and
disclaimer in a dialog.
