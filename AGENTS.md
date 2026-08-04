# Nightstand Agent Notes

## Working here as (or with) an AI agent

This file is written for AI coding agents, and contributions made with them are
welcome. The person who opens the PR is the author, full stop. You are expected
to have read, tested, and understood what you submit, and you answer for review
feedback and for anything it breaks. How the code was produced does not matter
to review, and no disclosure is expected either way; what matters is that it is
correct and that you can stand behind it.

The bar does not move for agent-written code: tests with every change, lint and
typecheck clean on the files you touched, rebuilt output committed when source
changes (see [CONTRIBUTING.md](CONTRIBUTING.md)), and the hardware cautions
below taken seriously. This software runs under a sleeping person. Nothing
lands that you could not explain line by line.

If you point an agent at this repo, have it read this file and CONTRIBUTING.md
first, and [docs/EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) before
it touches anything hardware-adjacent.

## What This Repo Is
- Nightstand is a local controller for 8 Sleep Pods. The server runs on the Pod's embedded Linux system and exposes a local REST API. The app is a React/MUI web UI served by the server.
- The Pod hardware is controlled through a Unix socket called `dac.sock`; this repo calls that integration "Franken" or "Franken sock".
- Persistent user data lives under `/persistent/free-sleep-data/` on the Pod. Local development mirrors parts of that under `server/free-sleep-data/`.

## Top-Level Layout
- `app/`: Vite React frontend using MUI, Zustand, React Query, and Axios.
- `server/`: Express TypeScript backend, LowDB JSON settings/schedules, Prisma SQLite metrics, node-schedule jobs, and Franken socket control.
- `biometrics/`: Python stream processing, sleep detection, vitals calculation, and SQLite writes for biometrics.
- `scripts/`: Pod install/update/reset/service helper scripts.
- `docs/`: user-facing screenshots, hardware teardown/install docs,
  [EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) (reverse-engineered
  hardware protocol reference, see below), and
  [CALIBRATION.md](docs/CALIBRATION.md) (catalog classifying the numeric
  constants used for sleep detection as hardware fact, timing margin,
  population bound, or per-bed learned).

## Common Commands
- App typecheck: `cd app && npx tsc -b`
- App lint: `cd app && npm run lint`
- App dev server: `cd app && VITE_POD_IP=<pod-ip> npm run dev`
- Server typecheck without writing `dist`: `cd server && npx tsc --noEmit`
- Server lint: `cd server && npm run lint`
- Server hot reload on Pod: `fs-dev-server` per `server/README_SERVER.md`
- Server local dev: `cd server && npm run dev:local`

## Runtime Notes
- `server/src/config.ts` requires `DATA_FOLDER` and `ENV`; Pod runtime gets these through `server/.env.pod` via `npm start`.
- `server/src/jobs/jobScheduler.ts` schedules jobs at import time and watches the LowDB folder for changes. Writes to settings or schedules trigger full job cancellation and recreation.
- Schedule data is stored in `schedulesDB.json`; settings are stored in `settingsDB.json`; service health is stored in `servicesDB.json`.
- The app imports schemas directly from `server/src/db/*Schema.ts`; schema changes must remain compatible with both app and server TypeScript settings.

## Scheduling Hotspots
- Client schedule state lives in `app/src/pages/SchedulePage/scheduleStore.tsx`.
- Schedule save payloads are assembled in `app/src/pages/SchedulePage/SchedulePage.tsx`.
- Server schedule writes are handled by `server/src/routes/schedules/schedules.ts`.
- Scheduled jobs are created in:
  - `server/src/jobs/powerScheduler.ts`
  - `server/src/jobs/temperatureScheduler.ts`
  - `server/src/jobs/alarmScheduler.ts`
  - `server/src/jobs/primeScheduler.ts`

## Franken Hotspots
- Socket lifecycle: `server/src/8sleep/frankenServer.ts`
- Socket server wrapper: `server/src/8sleep/unixSocketServer.ts`
- Message parsing: `server/src/8sleep/messageStream.ts`
- Hardware command map: `server/src/8sleep/deviceApi.ts`
- Device status parsing: `server/src/8sleep/loadDeviceStatus.ts`
- Startup initializes Franken from `server/src/server.ts`; health is surfaced through `server/src/serverStatus.ts`.

## Reverse-engineered hardware protocol
- **[docs/EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md)** is the
  consolidated reference for the `dac.sock` command table, `DEVICE_STATUS`
  fields, and the RAW biometrics telemetry record types (`frzHealth`,
  `frzTemp`, `bedTemp2`, etc.), cross-referenced against other independent
  reverse-engineering projects (8rp, sleepypod/core, opensleep, ninesleep),
  each entry tagged with whether *we* verified it or are trusting a source.
  Check it before assuming a command does what its name implies.
- **Read-only commands (`DEVICE_STATUS`/14, `HELLO`/0) are safe to probe
  freely.** State-changing commands are not: the pod is a physical device
  with a person potentially asleep on it. Before relying on a command from
  an external doc, prefer testing it live against real hardware over
  trusting the source blindly: e.g. `STOP_PRIME`/17 is documented by 8rp but
  did not visibly interrupt an active priming cycle when tested against a
  Pod 5 (see the protocol doc), a UI feature was built on that assumption,
  then reverted once the test came back negative. If you can't test safely,
  say so explicitly rather than shipping unverified.
- **A single unix socket connection matters.** `dac.sock` expects exactly
  one active consumer; opening a second ad-hoc connection while the real
  server has one open can evict/destroy the live one (see the comments in
  `unixSocketServer.ts`). Don't script a raw probe against a running pod's
  socket, go through the existing `/api/deviceStatus` or `/api/jobs`
  endpoints instead, which reuse the server's managed connection.

## Review Cautions
- Check timezone behavior with `moment-timezone`; the app sets a default timezone after settings load, and server jobs set `RecurrenceRule.tz`.
- Prefer adding tests or small reproductions around scheduling time math before changing job timing.
- When reviewing install/update scripts, remember they run as root or through sudo on an embedded Yocto-based system.


# Code smells
- Any complicated functions should have concise, short comments explaining what the function does
- Do not write obscure code with abbreviated variable names <= 2 characters
- Scalability is important, don't write one off hacks. Ensure new files and code are placed in appropriate locations.

