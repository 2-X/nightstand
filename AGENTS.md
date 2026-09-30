# Nightstand agent notes

These notes are for AI coding agents working in this repository. Read
[CONTRIBUTING.md](CONTRIBUTING.md) as well, and read
[docs/EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) before changing
anything that talks to the hardware.

## Contributions made with agents

Agent-written contributions are welcome and reviewed like any other. The
person who opens the pull request is its author: they are expected to have
read, tested, and understood it, and they answer for review feedback and for
anything it breaks. No disclosure is needed either way.

The bar is the same for agent-written code. This software controls a bed that
someone is sleeping on, so nothing should land that its author could not
explain line by line.

## Rules for every change

- Base work on `dev` and open pull requests against `dev`. Do not commit to
  or push `main`; it moves only when the maintainer cuts a release.
- Add or update tests for the logic you change (see "Tests" in
  CONTRIBUTING.md).
- Before you report a change as done, run the checks in
  [Commands](#commands) for every package you touched, and say which ones you
  ran.
- `server/dist/` and `server/public/` are committed build output. Never edit
  them by hand. Rebuild them once at the end of a batch of changes, and as the
  last step of a release: `npm ci && npm run build:pr` in `server/` and `app/`,
  then remove the files `scripts/check-bundles.sh` lists, and commit.
- Commit messages follow Conventional Commits as described in
  CONTRIBUTING.md, with no trailers. Do not add `Co-Authored-By` or
  "Generated with" lines.
- Prisma migrations must be additive. Never drop or rename a column or table
  that an older, still-installable release reads; rollbacks run the older
  server against the newer schema.
- Do not run commands against a live Pod (SSH, deploy scripts, API calls that
  change state) unless the user asks for that specific action.

## What this repo is

- Nightstand is a local controller for Eight Sleep Pods. The server runs on
  the Pod's embedded Linux system and exposes a local REST API. The app is a
  React/MUI web UI served by the server.
- The Pod hardware is controlled through a Unix socket called `dac.sock`.
  This repo calls that integration "Franken" or "Franken sock".
- Persistent user data lives under `/persistent/free-sleep-data/` on the
  Pod. Local development mirrors parts of it under `server/free-sleep-data/`.

## Layout

- `app/`: Vite React frontend using MUI, Zustand, React Query, and Axios.
  Unit tests sit next to components; Playwright tests are in `app/e2e/`.
- `server/`: Express TypeScript backend with LowDB JSON settings and
  schedules, Prisma SQLite metrics, node-schedule jobs, and Franken socket
  control. `server/prisma/` holds the schema and migrations.
- `biometrics/`: Python stream processing, sleep detection, vitals
  calculation, and SQLite writes for biometrics. Tests are in
  `biometrics/__tests__/`; see [biometrics/BIOMETRICS.md](biometrics/BIOMETRICS.md).
- `scripts/`: Pod install, update, reset, and service helper scripts, plus
  maintainer tools such as `promote_release.sh` and `deploy-dev.sh`.
- `ops/`: LAN deployment (`deploy.sh`, `rollback.sh`) and the safety rules in
  [ops/ANTIBRICK.md](ops/ANTIBRICK.md).
- `docs/`: user-facing screenshots, hardware teardown and install docs,
  [EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) (the
  reverse-engineered hardware protocol reference, see below), and
  [CALIBRATION.md](docs/CALIBRATION.md) (a catalog classifying the numeric
  constants used for sleep detection as hardware fact, timing margin,
  population bound, or per-bed learned value).
- `releases.json` and `CHANGELOG.md`: the release manifest that installed
  Pods read, and the user-facing changelog. Both change only as part of a
  release, except for notes under `## [Unreleased]` in the changelog.

## Commands

Setup (the app imports schemas from `server/src`, so it needs the server's
dependencies too):

- `cd server && npm ci && npm run generate` (the Prisma client is needed for
  the server's build and tests)
- `cd app && npm ci`

Server, from `server/`:

- Typecheck without writing `dist`: `npx tsc --noEmit`
- Lint: `npm run lint`
- Test: `npm test` (`node:test`, files matching `src/**/*.test.ts`)
- Build into `server/dist/`: `npm run build:pr`
- Local dev: `npm run dev:local`, after pointing `DATA_FOLDER` and
  `DATABASE_URL` in `server/.env.local` at your machine
- Hot reload on a Pod: `fs-dev-server`, per
  [server/README_SERVER.md](server/README_SERVER.md)

App, from `app/`:

- Typecheck: `npx tsc -b`
- Lint: `npm run lint`
- Test: `npm test` (Vitest)
- Build into `server/public/`: `npm run build:pr`
- Dev server against a Pod: `VITE_POD_IP=<pod-ip> npm run dev`
- Dev server with mock data and no Pod: `VITE_ENV=demo npx vite`
- End-to-end: `npx playwright install chromium`, then
  `npm run build:demo && npx playwright test`

Biometrics, from the repository root (Python 3.9, as in CI):

- `python -m pytest biometrics/__tests__/`

## Runtime notes

- `server/src/config.ts` requires `DATA_FOLDER` and `ENV`. On the Pod,
  `npm start` supplies them from `server/.env.pod`.
- `server/src/jobs/jobScheduler.ts` schedules jobs at import time, once the
  system clock is valid, and watches the LowDB folder. A write to settings or
  schedules cancels and recreates every job; writes to `servicesDB.json` are
  ignored.
- Schedules are stored in `schedulesDB.json`, settings in `settingsDB.json`,
  and service health in `servicesDB.json`.
- The app imports schemas directly from `server/src/db/*Schema.ts`, so schema
  changes must compile under both the app's and the server's TypeScript
  settings.
- The server does not apply Prisma migrations. `scripts/install.sh` and
  `scripts/update.sh` apply them with `prisma migrate deploy`.

## Scheduling code

- Client schedule state: `app/src/pages/SchedulePage/scheduleStore.tsx`.
- Schedule save payloads are assembled in
  `app/src/pages/SchedulePage/SchedulePage.tsx`.
- Server schedule writes: `server/src/routes/schedules/schedules.ts`.
- Scheduled jobs are created in:
  - `server/src/jobs/powerScheduler.ts`
  - `server/src/jobs/temperatureScheduler.ts`
  - `server/src/jobs/alarmScheduler.ts`
  - `server/src/jobs/primeScheduler.ts`

## Franken code

- Socket lifecycle: `server/src/8sleep/frankenServer.ts`
- Socket server wrapper: `server/src/8sleep/unixSocketServer.ts`
- Message parsing: `server/src/8sleep/messageStream.ts`
- Hardware command map: `server/src/8sleep/deviceApi.ts`
- Device status parsing: `server/src/8sleep/loadDeviceStatus.ts`
- `server/src/server.ts` connects Franken at startup; its health is reported
  through `server/src/serverStatus.ts`.

## Other subsystems

- Live updates to the app: `server/src/ws/wsServer.ts` (WebSocket at
  `/ws/events`), fed by `server/src/events/eventBus.ts`.
- Adjustable base control over Bluetooth:
  `server/src/8sleep/trimixBaseControl.ts`.
- Presence-based auto-off: `server/src/8sleep/presenceAutoOffMonitor.ts`.
- Calibration status: `server/src/routes/calibration/`.
- In-app updates: `server/src/routes/update/`, which starts `scripts/update.sh`
  on the Pod through a systemd service.
- The systemd units and sudoers rules behind Update, Roll back, Revert to
  stock, Reboot, and the biometrics toggle all come from
  `scripts/setup_services.sh`, which every install and update path runs. A new
  control that needs sudo gets its rule there.
  `server/src/setupServicesScript.test.ts` fails if a `sudo` call in
  `server/src/jobs/` has no matching rule.

## Hardware protocol and safety

- [docs/EIGHT_SLEEP_PROTOCOL.md](docs/EIGHT_SLEEP_PROTOCOL.md) is the
  reference for the `dac.sock` command table, `DEVICE_STATUS` fields, and the
  RAW biometrics record types (`frzHealth`, `frzTemp`, `bedTemp2`, and
  others). It is cross-checked against other independent reverse-engineering
  projects (8rp, sleepypod/core, opensleep, ninesleep), and each entry says
  whether it was verified on this project's hardware or taken from a source.
  Check it before assuming a command does what its name suggests.
- Read-only commands (`DEVICE_STATUS`/14, `HELLO`/0) are safe. State-changing
  commands are not: the Pod is a physical device that may have someone
  asleep on it. A command documented elsewhere is not verified until it has
  been tested on real hardware. For example, `STOP_PRIME`/17 is documented by
  8rp, but it did not interrupt an active prime when tested on a Pod 5, and a
  UI feature built on it was reverted. If you cannot test a hardware
  assumption safely, say so rather than shipping it unverified.
- Never open your own connection to `dac.sock`. The server is the listener
  on that socket and the Pod's firmware connects to it as a client, so an
  extra connection can be taken for the firmware's or can replace a pending
  firmware connection (see `handleConnection` in `unixSocketServer.ts`). Read
  state with `GET /api/deviceStatus` and send commands through the API
  (`/api/deviceStatus` or `/api/execute`), which use the server's managed
  connection.

## Review cautions

- Check timezone behavior with `moment-timezone`. The app sets a default
  timezone after settings load, and server jobs set `RecurrenceRule.tz`.
- Add tests or small reproductions around scheduling time math before
  changing job timing.
- Install and update scripts run as root or through sudo on an embedded
  Yocto-based system. Review them with that in mind.

## Code style

Carried over from free-sleep's own agent notes:

- Give complicated functions a short comment explaining what they do.
- Avoid obscure code and variable names of two characters or fewer.
- Avoid one-off hacks, and put new files and code where they belong in the
  existing structure.
