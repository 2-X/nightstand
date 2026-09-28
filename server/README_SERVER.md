# Server documentation

## Overview
Notes for working on the Express server that runs on the Eight Sleep Pod: how
to run it during development, how the code is organized, and the manual
changes made on the Pod itself. For the request and response formats of the
device commands, see [API.md](./API.md).

The server listens on port 3000. It serves the REST API under `/api/`, a
WebSocket stream at `/ws/events`, and the built React app from `public/`.

## Running the server

### Prerequisites
- [Volta](https://volta.sh/), which installs the Node version pinned in
  `package.json` (currently 24.11.0).

### On the Pod
`scripts/install.sh` installs dependencies, applies database migrations, and
creates the `free-sleep` systemd service, which runs `npm start` (see
[INSTALLATION.md](../INSTALLATION.md)). `npm start` loads `.env.pod`, which
points at `/persistent/free-sleep-data/`, so it only works on a Pod.

### On your computer
Running locally is useful for work on routes, the database, and the job
scheduler. With `ENV="local"` the server does not connect to the Pod's
Franken socket, so anything that talks to the hardware will not work. For
work on the UI alone, the app's demo mode needs no server at all (see
[app/README_APP.md](../app/README_APP.md#developing)).

1. Install dependencies:
   ```bash
   cd server
   npm ci
   npm run generate
   ```
2. Edit `.env.local`. The committed values are from another developer's
   machine.
   - `DATA_FOLDER` is an absolute path ending in `/`. The server appends
     `lowdb/` to it. The git-ignored `server/free-sleep-data/` folder works
     for this.
   - `DATABASE_URL` is `file:` followed by the SQLite file path, for example
     `file:<DATA_FOLDER>free-sleep.db`.
3. Create the `lowdb/` folder inside `DATA_FOLDER`. The server writes its JSON
   files there on startup but does not create the folder. With the in-repo
   folder:
   ```bash
   mkdir -p free-sleep-data/lowdb
   ```
4. Create the SQLite database. The server never applies migrations itself:
   ```bash
   npx dotenv -e .env.local npx prisma migrate deploy
   ```
5. Start the server. nodemon restarts it when a file in `src/` changes:
   ```bash
   npm run dev:local
   ```

After changing `prisma/schema.prisma`, create a migration with
`npm run migrate:local <migration_name>`.

Typecheck, lint, and test commands are in
[CONTRIBUTING.md](../CONTRIBUTING.md).

### Hot reloading on the Pod

This is a development workflow on an idle test Pod. It has no automatic
backup or rollback step, and schedules and alarms pause while the server is
stopped. For committed development deployments use
[ops/deploy.sh](../ops/ANTIBRICK.md); for published releases use the app updater.

`npm run dev` runs the TypeScript source with nodemon and restarts on changes
to `src/`. It reads `.env.pod`, so it runs on the Pod.

1. SSH into the Pod. Stop the service so it releases port 3000 and the
   `dac.sock` connection, then start the dev server as the `dac` user:
   ```bash
   systemctl stop free-sleep
   su - dac -c "cd /home/dac/free-sleep/server && /home/dac/.volta/bin/npm run dev"

   # When you're done, press Ctrl+C and start the service again:
   systemctl start free-sleep
   ```
   Running it as `dac` matches the service and keeps files it writes under
   `/persistent/free-sleep-data/` owned by that user. The `fs-dev-server`
   alias from `scripts/add_shortcuts.sh` runs the first two commands (see
   [INSTALLATION.md](../INSTALLATION.md)).
2. Because nodemon watches `src/` on the Pod, edits have to land there. An
   editor that uploads on save does this, for example VS Code's
   [Remote - SSH](https://code.visualstudio.com/docs/remote/ssh) or a JetBrains
   [deployment configuration](https://www.jetbrains.com/help/idea/tutorial-deployment-in-product.html#downloading).
   `scripts/deploy-dev.sh` is a different workflow: it builds on your computer
   and copies `dist/` and `public/` to the Pod.
3. To run the app with hot reload against the same Pod, see
   [app/README_APP.md](../app/README_APP.md#developing).

---

## Architecture

### Entry point (`src/server.ts`)
Registers middleware and routes, starts listening, attaches the WebSocket
server, and connects to Franken (skipped when `ENV="local"`). On `SIGTERM` or
`SIGINT` it stops scheduled jobs, flushes SQLite, and closes connections
before exiting.

### Routes
Each route group lives in its own folder under `src/routes/` and is
registered in `src/setup/routes.ts`.

Device control:
- **`/api/deviceStatus`:** Read (GET) and change (POST) the device state.
- **`/api/settings`:** Timezone, per-side settings (name, away mode, tap
  gestures), daily priming, temperature format, daily reboot, RAW archive
  retention, update channel, and feature flags.
- **`/api/schedules`:** Daily power, temperature, and alarm schedules.
- **`/api/execute`:** Sends a raw Franken command (`SET_TEMP`, `PRIME`, and
  others). See [API.md](./API.md).
- **`/api/alarm`:** Starts the vibration alarm immediately.
- **`/api/base-control`:** Compatible adjustable-base hardware: read the state,
  set head and foot positions, run a preset (`/preset`), or stop (`/stop`).
- **`/api/jobs`:** Runs jobs on demand: sleep analysis and sensor calibration
  per side, update, and reboot.
- **`/api/update`:** POST starts `free-sleep-update.service` (which runs
  `scripts/update.sh`), after writing the requested version to
  `/persistent/free-sleep-data/update-target.json` when one is given. Also
  `/api/update/rollback-info`, `/api/update/rollback`, and
  `/api/update/revert-to-stock`, which switches to upstream free-sleep, not Eight Sleep firmware.
- **`/api/calibration`:** Each side's capacitive-sensor calibration profile,
  the run that produced it, and the most recent run.
- **`/api/changelog`:** `CHANGELOG.md` parsed into entries for the in-app
  changelog. Parsed once per process.

Biometrics and sleep data (all under `/api/metrics/`):
- **`vitals`** and **`vitals/summary`:** Heart rate, HRV, and breathing rate,
  as rows and as summary statistics.
- **`movement`:** Movement records derived from piezo data.
- **`sleep`:** Sleep records (`entered_bed_at`, `left_bed_at`,
  `present_intervals`). GET, PUT to edit, and DELETE `sleep/:id`.
- **`sleep-stages`:** Sleep stage (awake, REM, light, deep) per interval.
- **`sleep-score`:** Score for one sleep period.
- **`presence`:** Current presence per side. The biometrics service POSTs it
  and the server keeps it in memory.

Operations:
- **`/api/serverStatus`:** Health of each server component and service
  (Express, jobs, Franken socket, biometrics, database, and others).
- **`/api/services`:** Read and change service state. Currently this is
  biometrics on or off and the status of its jobs.
- **`/api/logs`** and **`/api/logs/:filename`:** List log files, and stream one
  over server-sent events.
- **`/api/metrics/server`:** In-process metrics as JSON: Franken command
  latency (p50 and p95), timeout count, queue depth, WebSocket client count,
  job run counts, memory, and uptime. From a Pod shell:
  `curl localhost:3000/api/metrics/server`.
- **`/api/storage`:** Disk usage on `/persistent` (logs, RAW archive, SQLite).
- **`/api/memory`:** RAM usage, from `/proc/meminfo` on the Pod and Node's `os`
  module elsewhere.

### WebSocket (`src/ws/`, path `/ws/events`)
Messages are JSON of the form `{ channel, payload, ts }`. A new client first
receives a `hello` message. The other channels:
- `device-status`: the full device status whenever it changes. The app writes
  it into React Query's cache without an HTTP request.
- `service-health`: a partial server-status update when a check becomes
  healthy or fails. The app refetches server status.
- `job-event`: a scheduled job (alarm, temperature change, prime, and others)
  started, succeeded, or failed. The app refetches device and server status.

The server pings each client every 15 seconds and closes any client that did
not answer the previous ping. The app reconnects with exponential backoff
capped at 30 seconds, and while it is disconnected each React Query hook
falls back to its own polling interval.

### Franken socket (`src/8sleep/`)
The server talks to the Pod's "Franken" process over a Unix socket, following
the approach of the original Pod code in `/home/dac/app/`. The socket path
differs between Pod models and firmware versions. `install.sh` detects it and
writes it to `/persistent/free-sleep-data/dac_sock_path.txt`; without that
file the server uses `/deviceinfo/dac.sock`.

Commands run one at a time through a queue. Each is limited to
`FRANKEN_COMMAND_TIMEOUT_MS` (default 5000). On a timeout the caller receives
an error and the connection is closed, so the next command opens a new one.

`FrankenMonitor` polls the device every 2 seconds whether or not a client is
connected, because the same loop detects tap gestures. Adjustable-base
actions triggered by those gestures require compatible base hardware.

### Job scheduler (`src/jobs/`)
Uses `node-schedule` for power, temperature, alarm, priming, reboot, and the
daily analysis jobs. It watches the LowDB folder and rebuilds the jobs when
schedules or settings change. Changes to `servicesDB.json` (job status and
sensor readings) are ignored, since they never affect the schedule.

### Storage (`src/db/`)
- **LowDB**, JSON files in `/persistent/free-sleep-data/lowdb/`, for
  configuration:
  - `schedulesDB.json`: daily schedules
  - `settingsDB.json`: settings
  - `servicesDB.json`: service state and job status

  Each is validated with `zod` and written with defaults on startup if missing.
- **SQLite through Prisma**, at `/persistent/free-sleep-data/free-sleep.db`,
  for biometric data and calibration. Tables: `vitals`, `movement`,
  `sleep_records`, `calibration_profiles`, `calibration_runs`, and
  `water_level_events` (see `prisma/schema.prisma`).
  - The server does not apply migrations. `scripts/install.sh` applies them on
    install, and `scripts/update.sh` runs `prisma migrate deploy` during an
    update when any are pending (with retries; skipped on a downgrade).
    `/api/serverStatus` lists migrations that have not been applied.
  - Read helpers: `loadMovementRecords.ts` and `loadSleepRecords.ts`. The vitals
    route queries Prisma directly.

---

## File structure
```text
server/
├── API.md                  # Franken command reference for /api/execute
├── free-sleep-data/        # Git-ignored local DATA_FOLDER (mirrors /persistent/free-sleep-data/)
├── prisma/
│   ├── schema.prisma       # SQLite schema
│   └── migrations/         # Applied by scripts/install.sh and scripts/update.sh
├── public/                 # Built React app, served as static files (output of the app build)
├── dist/                   # Compiled server (tsc); committed, run by npm start
├── src/
│   ├── 8sleep/             # Franken socket client, command queue, monitor, base control
│   ├── agent/              # File list for the maintainer's stock-to-Nightstand tooling (not used at runtime)
│   ├── db/                 # LowDB stores, Prisma client, schemas, read helpers
│   ├── events/             # In-process event bus
│   ├── features/           # Feature manifest (tooling, not runtime)
│   ├── jobs/               # Scheduled jobs and job events
│   ├── metrics/            # In-process metrics
│   ├── routes/             # One folder per route group
│   ├── setup/              # Middleware (CORS, request logging) and route registration
│   ├── ws/                 # WebSocket server
│   ├── config.ts           # Reads DATA_FOLDER and ENV, finds dac.sock
│   ├── logger.ts           # Winston logger
│   ├── serverStatus.ts     # Health state reported by /api/serverStatus
│   └── server.ts           # Entry point
├── .env.pod                # Pod environment (used by npm start and npm run dev)
├── .env.local              # Local environment (used by npm run dev:local)
├── package.json
└── tsconfig.json
```

---

## Pod-side runtime configuration

The resource figures and firmware behavior below were observed on the
maintainer's Pod 5. They are not model-independent measurements.

Items 1 to 3 concern services on the Pod itself, outside this repo, and were
done by hand to save RAM, CPU, and disk. Replay items 1 and 3 on a re-imaged
or new Pod if you want them; each can be undone. Items 4 to 6 are in the
repo; item 6 needs a manual step in one case, described there.

### 1. Cap journald at 100 MB (recovers ~700 MB on `/persistent`)

`/var/log/journal` is symlinked to `/persistent/journal`, so unbounded systemd
logs use space on the persistent partition.

```bash
# On the Pod (as root):
sed -i.bak 's/^SystemMaxUse=.*/SystemMaxUse=100M/' /etc/systemd/journald.conf
systemctl restart systemd-journald
journalctl --vacuum-size=100M
```

The `sed` command only changes an uncommented `SystemMaxUse=` line. Confirm
the change with `grep '^SystemMaxUse' /etc/systemd/journald.conf`.

Reverse: `cp /etc/systemd/journald.conf.bak /etc/systemd/journald.conf && systemctl restart systemd-journald`.

### 2. Leave `Eight.Capybara` running (it makes the quad-tap buzz)

Capybara is Eight Sleep's cloud-telemetry agent. It uses about 180 MB of RAM
and 11% CPU, and this server does not use its `capybara-dac` socket, so it
looks safe to disable. It is not: Capybara makes the confirmation buzz for
the quad-tap gesture. The firmware buzzes on its own for double and triple
taps, but disabling Capybara removes the quad-tap buzz without any error. If
it has been disabled, turn it back on with `systemctl enable --now capybara`.

If this server makes the quad-tap buzz itself in the future, Capybara could
then be disabled.

### 3. Pin the resolved node binary in `free-sleep.service` (frees ~30 MB RAM)

The unit written by `install.sh` starts the server with `npm run start`,
which leaves the npm and dotenv-cli wrapper processes running above the node
process that serves requests. Pointing `ExecStart` at the node binary
directly leaves one process.

`npm start` is what normally loads `.env.pod`, so the pinned command passes
it to node with `--env-file`. Without it the server exits at startup with
`Missing DATA_FOLDER || ENV in env`.

```bash
# On the Pod:
NEW_NODE_PATH=$(sudo -u dac /home/dac/.volta/bin/volta which node)
SVC=/etc/systemd/system/free-sleep.service
cp "$SVC" "${SVC}.bak"
sed -i "s|^ExecStart=.*|ExecStart=${NEW_NODE_PATH} --env-file=.env.pod dist/server.js|" "$SVC"
systemctl daemon-reload
systemctl restart free-sleep
```

Verify with `pstree -p $(systemctl show -p MainPID --value free-sleep)`. It
should show a single node process.

Reverse: `cp ${SVC}.bak ${SVC} && systemctl daemon-reload && systemctl restart free-sleep`.

The pinned path includes the node version. If the version pinned in
`package.json` changes, run the snippet again to pick up the new binary.
Running `scripts/install.sh` again rewrites the unit with `npm run start`,
which removes the pin.

### 4. Quieter access logging (in the repo)

Responses that succeed in under 250 ms are logged at `debug` rather than
`info`. The service runs with `NODE_ENV=production`, where the default
`LOG_LEVEL` is `info`, so only responses with status 400 or above and slow
responses are logged. See
[setup/requestLogging.ts](src/setup/requestLogging.ts). For verbose access
logs, set `LOG_LEVEL=debug` in `/home/dac/free-sleep/server/.env.pod` and
restart the service. The next update replaces that file.

### 5. Throttled presence-debug log (in the repo)

[`biometric_processor.py`](../biometrics/stream/biometric_processor.py) logs
`[presence-debug]` once a minute per side. `PRESENCE_DEBUG_LOG_INTERVAL_S`
changes the interval.

### 6. RAW file archive (keeps overnight piezo data for the daily analysis)

The Pod firmware writes a RAW piezo file of about 6.7 MB roughly every 15
minutes into `/persistent/` and keeps about 75 minutes of them. After trying
to upload each file to `raw-api-upload.8slp.net:1337` (which times out,
because `block_internet_access.sh` blocks outbound TCP/1337), it deletes
anything older than that window. Without an archive, by midday the previous
night's files are gone, and the daily `analyze_sleep` job finds nothing for
anyone who got up more than about an hour before it ran.

[`scripts/archive-raw.sh`](../scripts/archive-raw.sh) runs every minute from a
systemd timer and hardlinks new RAW files into
`/persistent/free-sleep-data/raw-archive/`. A hardlink shares the file's data,
so the archive keeps the data after the firmware deletes its copy, and until
then the file takes space only once. Files are kept for 14 days by default
(about 5.5 GB). Settings offers 2 days to 2 months. If the data partition
drops below 2 GB free, the oldest archived files are removed first. The
biometrics loader [`load_raw_files.py`](../biometrics/load_raw_files.py) reads
both `/persistent/` and the archive (deduplicated by filename), so the
analysis sees the previous 12 hours whenever it runs.

`scripts/install.sh` and `scripts/update.sh` install and enable the timer
(safe to repeat), so a fresh install or an in-app or `fs-update` update needs
no extra step. `ops/deploy.sh` and `scripts/deploy-dev.sh` copy code but not
systemd units, so the first time you use either on a Pod, install the timer
by hand:

```bash
# From your computer, in the repo root:
scp -P 8822 scripts/archive-raw.sh root@<pod>:/home/dac/free-sleep/scripts/
scp -P 8822 scripts/systemd/free-sleep-archive-raw.{service,timer} root@<pod>:/etc/systemd/system/
ssh -p 8822 root@<pod> 'chmod +x /home/dac/free-sleep/scripts/archive-raw.sh \
  && systemctl daemon-reload \
  && systemctl enable --now free-sleep-archive-raw.timer'
```

Verify with `systemctl status free-sleep-archive-raw.timer` (it should show
`active (waiting)` with the next trigger under 60 seconds away) and
`ls /persistent/free-sleep-data/raw-archive/ | wc -l` (the count should grow by
about 4 an hour).

Reverse: `systemctl disable --now free-sleep-archive-raw.timer && rm -rf /persistent/free-sleep-data/raw-archive/`.

### Checking the results

```bash
# Available RAM:
ssh -p 8822 root@<pod> 'free -h | head -2'

# /persistent usage (journald capped at 100 MB; the RAW archive also lives here):
ssh -p 8822 root@<pod> 'df -h /persistent | tail -1'

# Capybara should still be active (see item 2):
ssh -p 8822 root@<pod> 'systemctl status capybara || true'

# Single-process node:
ssh -p 8822 root@<pod> 'pstree -p $(systemctl show -p MainPID --value free-sleep)'
```
