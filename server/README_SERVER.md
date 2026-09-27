# Server documentation

## Overview
Express server that runs on the Eight Sleep Pod.

## Developing

### Hot reloading (on Pod)
1. SSH into the Pod, stop the running service so it isn't holding the port
   or the `dac.sock` connection, and run the server directly:
   ```bash
   systemctl stop free-sleep
   cd /home/dac/free-sleep/server && npm run dev

   # When you're done, Ctrl+C out of the dev process and restart the service:
   systemctl start free-sleep
   ```
2. Run the front-end app with hot reload and point it to your Pod [app/README_APP.md](../app/README_APP.md#Developing)

A shell alias for step 1, `fs-dev-server`, is set up on the Pod by
`scripts/add_shortcuts.sh` (see [INSTALLATION.md](../INSTALLATION.md)); it
runs the same stop-service-then-`npm run dev` sequence in one command.

### Hot reloading (on computer, not your Pod)
- `npm run dev:local`

A remote-file-sync feature in your editor (VS Code's
[Remote - SSH](https://code.visualstudio.com/docs/remote/ssh), JetBrains'
[deployment config](https://www.jetbrains.com/help/idea/tutorial-deployment-in-product.html#downloading))
makes the on-Pod loop above less tedious by uploading changes as you save,
instead of needing a separate deploy step per edit.

--- 


## Architecture
The server is composed of the following key components:

### 1. Core server (`server.ts`)
- Sets up and starts an Express.js server.
- Initializes middleware and routes.
- Manages graceful shutdown processes for reliability.

### 2. Routes

Device control:
- **`/api/deviceStatus`:** Fetches and updates the status of the device.
- **`/api/settings`:** Manages device settings (timezone, away mode, priming schedules, temperature format, daily reboot).
- **`/api/schedules`:** Daily schedules for power on/off, temperature, and alarms.
- **`/api/execute`:** Sends raw franken commands directly to the device (`SET_TEMP`, `PRIME`, etc.). See [API.md](./API.md).
- **`/api/alarm`:** Trigger / dismiss the bed-vibration alarm.
- **`/api/base-control`:** Adjustable-base position control (Pod 4+): get state, set head/foot %, run preset, stop.
- **`/api/jobs`:** Manually run a scheduled job (e.g. analyze-sleep) on demand.
- **`/api/update`:** Start an install/rollback (writes the update target, then triggers `scripts/update.sh`), plus `/api/update/rollback-info` and `/api/update/rollback` for the instant-rollback flow.
- **`/api/calibration`:** Read the per-side capacitive-sensor calibration profile and its most recent run.
- **`/api/changelog`:** Parsed `CHANGELOG.md` entries for the in-app changelog view (cached for the life of the process).

Biometrics & sleep data:
- **`/api/metrics/vitals`** + **`/api/metrics/vitals/summary`:** Heart rate, HRV, breathing rate (raw rows + summary stats).
- **`/api/metrics/movement`:** Bed-movement records derived from piezo data.
- **`/api/metrics/sleep`:** Sleep records (entered_bed_at / left_bed_at / present_intervals); supports GET, PUT (edit), DELETE.
- **`/api/metrics/sleep-stages`:** Per-epoch sleep-stage classification (awake / REM / light / deep).
- **`/api/metrics/sleep-score`:** Aggregate score for a given sleep period.
- **`/api/metrics/presence`:** Real-time presence flags per side (in-memory; updated by the biometrics service).

Operations & introspection:
- **`/api/serverStatus`:** Health snapshot of every service (express, jobs, franken socket, biometrics, etc.).
- **`/api/services`:** Toggle and inspect service state (currently just enable/disable biometrics and its per-job status).
- **`/api/logs`** + **`/api/logs/:filename`:** List log files and stream content via SSE.
- **`/api/metrics/server`:** In-process metrics, Franken command latency p50/p95,
  timeout count, queue depth, WS client count, job exec counts, memory/uptime.
  Read-only JSON; useful for debugging on the pod (`curl localhost:3000/api/metrics/server`).
- **`/api/storage`:** Disk usage on `/persistent` (logs, RAW archive, SQLite files).
- **`/api/memory`:** RAM usage (`/proc/meminfo` on the Pod, `os.*` APIs elsewhere).

### 3. WebSocket (`/ws/events`)
- Real-time push channel for the React app. Frames are JSON envelopes
  `{ channel, payload, ts }` with channels:
  - `device-status`, full DeviceStatus snapshot whenever it changes (the
    FrankenMonitor diffs and only emits on actual change). The app uses this
    to update React Query's cache in place; no follow-up HTTP refetch.
  - `service-health`, partial server-status patch when a check transitions
    (healthy or failed). Triggers a `useServerStatus` invalidation on the client.
  - `job-event`, fired when a scheduled job starts / succeeds / fails
    (alarms, temperature changes, prime, etc.).
- Heartbeat: server pings every 15s; a client that has not answered the
  previous ping by the next tick is dropped, so a dead connection is
  detected within one to two heartbeat intervals.
- Client wraps native `WebSocket` (no library); auto-reconnects with
  exponential backoff up to 30s. While disconnected, the React Query hooks
  fall back to their own polling interval (per hook; mostly 30 to 60 seconds).
- `FrankenMonitor` polls the Franken socket at a fixed 2s regardless of
  WebSocket client count (Pod 4+ only, Pod 3's slower path was removed): this
  loop is also where physical tap gestures are detected, so it stays fast
  even when nobody has the app open.

### 4. Command timeouts (`Franken`)
- Every dac.sock command is bounded by `FRANKEN_COMMAND_TIMEOUT_MS`
  (default 5000, env-overridable). On timeout the queued caller is rejected
  and the connection is torn down so the next call rebuilds it. Previously,
  a hung pod stalled the entire server until process restart.

### 5. Jobs scheduler (`src/jobs/`)
- Schedules periodic tasks like temperature adjustments, power on/off, and device priming using the `node-schedule` library.
- Watches the LowDB folder (`src/db/`) and, on a change to schedules or settings, clears and recreates all jobs. Changes to `servicesDB.json` (job-status pings, sensor readings) are ignored since they never need a reschedule.

### 6. Database (`src/db/`)
Hybrid setup, different storage backends for different data shapes:
- **LowDB (JSON files at `/persistent/free-sleep-data/lowdb/`)** for low-volume config data:
  - `schedulesDB.json`, daily schedules (power, temperature, alarms)
  - `settingsDB.json`, timezone, away mode, prime time, etc.
  - `servicesDB.json`, service enable/disable state and per-job status
  - Schemas validated with `zod`. Files are created on first run; you do not need to create them.
- **SQLite via Prisma (`/persistent/free-sleep-data/free-sleep.db`)** for biometric time-series and calibration:
  - Tables: `vitals`, `movement`, `sleep_records`, `calibration_profiles`, `calibration_runs`, `water_level_events` (schema in `prisma/schema.prisma`).
  - Migrations in `prisma/migrations/` are not applied by the server process itself. `scripts/install.sh` runs `prisma migrate deploy` on a fresh install, and `scripts/update.sh` runs it (with retries, skipped on a version downgrade) as part of every update.
  - Read paths: `loadVitalsRecords.ts`, `loadMovementRecords.ts`, `loadSleepRecords.ts`.


### 7. Eight Sleep integration (`src/8sleep/`)
- Contains utilities to communicate with the "Franken" device using Unix sockets.
  - This is based on the existing code on the Pod in `/home/dac/app/`.

---

## Key features

### Device control
- The server connects to the device using a Unix socket @ `/deviceinfo/dac.sock` (varies by Pod version & firmware version, path is detected in install.sh script and saved to `/persistent/free-sleep-data/dac_sock_path.txt`)
- Commands are sent to the device for various operations, including temperature adjustments and status retrieval.

### Scheduling
- Jobs like temperature changes, power toggling, and device priming are scheduled based on user-defined schedules.
- Changes to schedules or settings automatically trigger updates to the jobs

---

## Installation

### Prerequisites
- Volta for node version control

### Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Start the server:
   ```bash
   npm start
   ```

---

## File structure
```text
server/
├── free-sleep-data/        # Local-dev mirror of /persistent/free-sleep-data/ on the Pod
├── prisma/
│   ├── schema.prisma       # SQLite schema for vitals, movement, sleep_records, calibration
│   └── migrations/         # Applied by scripts/install.sh and scripts/update.sh, not by the server
├── src/
│   ├── 8sleep/             # Franken socket client (dac.sock), command queue, monitor
│   ├── db/                 # LowDB stores + Prisma client + read helpers
│   ├── events/             # In-process eventBus (DeviceStatus / serverStatus / job events)
│   ├── jobs/               # node-schedule jobs + jobEvents emitter
│   ├── metrics/            # In-process metrics (latency histograms, queue depth, WS clients)
│   ├── routes/             # Express routes (one folder per resource group)
│   │   ├── alarm/  baseControl/  calibration/  changelog/  deviceStatus/
│   │   ├── execute/  jobs/  logs/  memory/  storage/  update/
│   │   ├── metrics/        # vitals, movement, sleep, sleepStages, sleepScore, presence
│   │   ├── metricsServer/  # /api/metrics/server
│   │   ├── schedules/  serverStatus/  services/  settings/
│   ├── ws/                 # WebSocket server (heartbeat + eventBus -> clients)
│   ├── setup/              # Middleware + route registration
│   ├── logger.ts           # Logging configuration
│   ├── server.ts           # Core server entry point
├── dist/                   # Compiled output (generated by TypeScript)
├── tsconfig.json
├── package.json
```

---

## Pod-side runtime configuration

These changes live on the Pod itself, not in this repo. They were applied
manually after a fresh install to free RAM/CPU/disk and quiet logs. If you
re-image a Pod or fork this onto a new device, replay them. Each is reversible.

### 1. Cap journald at 100 MB (recovers ~700 MB on `/persistent`)

`/var/log/journal` is symlinked to `/persistent/journal`, so unbounded systemd
logs eat into the persistent partition.

```bash
# On the Pod (as root):
sed -i.bak 's/^SystemMaxUse=.*/SystemMaxUse=100M/' /etc/systemd/journald.conf
systemctl restart systemd-journald
journalctl --vacuum-size=100M
```

Reverse: `cp /etc/systemd/journald.conf.bak /etc/systemd/journald.conf && systemctl restart systemd-journald`.

### 2. Disable `Eight.Capybara`, DO NOT (it owns the quad-tap haptic buzz)

Capybara is Eight Sleep's proprietary cloud-telemetry agent and on first
glance looks like dead weight (~180 MB RAM, ~11% CPU constant; free-sleep
doesn't use its `capybara-dac` socket). **However** Capybara also handles
the haptic confirmation buzz for the quad-tap gesture on the side of the
bed, the firmware natively buzzes for double/triple taps, but quad-tap
feedback comes from Capybara. Disabling the service silently kills that
feedback. Re-enable with `systemctl enable --now capybara` if it's been
disabled.

If a future change implements the quad-tap haptic in free-sleep itself,
Capybara could be safely disabled to reclaim the resources.

### 3. Pin the resolved node binary in `free-sleep.service` (frees ~30 MB RAM)

The default unit file used `/home/dac/.volta/bin/node`, that's volta's shim,
which exec's the real node but stays as an idle parent process. Pin to the
resolved path so there's only one process:

```bash
# On the Pod:
NEW_NODE_PATH=$(sudo -u dac /home/dac/.volta/bin/volta which node)
SVC=/etc/systemd/system/free-sleep.service
cp "$SVC" "${SVC}.bak"
sed -i "s|^ExecStart=.*|ExecStart=${NEW_NODE_PATH} dist/server.js|" "$SVC"
systemctl daemon-reload
systemctl restart free-sleep
```

Verify with `pstree -p $(systemctl show -p MainPID --value free-sleep)`, should
be a single node process, not parent + child.

Reverse: `cp ${SVC}.bak ${SVC} && systemctl daemon-reload && systemctl restart free-sleep`.

If volta upgrades the cached node version later, the pinned path will go stale.
Re-run the snippet above to refresh it.

### 4. Quieter access logger (in-repo)

The express access logger now demotes successful, fast (< 250 ms) responses
from `info` to `debug`. In production (`NODE_ENV=production`, default
`LOG_LEVEL=info`) those are dropped entirely; only ≥ 400 status codes or
slow responses are logged. See [setup/middleware.ts](src/setup/middleware.ts).
Set `LOG_LEVEL=debug` in `/home/dac/free-sleep/server/.env.pod` to bring back
verbose access logging temporarily.

### 5. Less spammy presence-debug log (in-repo)

[`biometric_processor.py`](../biometrics/stream/biometric_processor.py) now
emits `[presence-debug]` once a minute per side instead of every 30 s.

### 6. RAW-file archive (preserves overnight piezo data for daily analyze)

Frankenfirmware writes one ~6.7 MB RAW piezo file every ~15 min into
`/persistent/` and maintains a fixed-size rolling buffer (~75 min). After
uploading to `raw-api-upload.8slp.net:1337` (or attempting to, outbound
TCP/1337 is blocked by `block_internet_access.sh`, so uploads time out
indefinitely), it deletes anything older than the buffer window. Net
effect on a stock Pod: by ~midday the previous night's data is GONE
from `/persistent/` and the daily `analyze_sleep` job finds nothing for
sleepers who woke up more than ~1 hour before it ran.

[`scripts/archive-raw.sh`](../scripts/archive-raw.sh) hardlinks RAW files
into `/persistent/free-sleep-data/raw-archive/` on a 1-min systemd timer.
Hardlinks share inodes, frank's `rm` removes its filesystem entry, our
entry keeps the data alive (no double-counting against disk until frank
actually deletes). Retention is 14 days by default (about 5.5 GB), set in
Settings from 2 days to 2 months, and the oldest files go first if the data
partition drops below 2 GB free. The biometrics
loader [`load_raw_files.py`](../biometrics/load_raw_files.py) scans both
`/persistent/` and the archive (deduped by filename), so analyze always
sees the previous 12 h regardless of when it runs.

`scripts/install.sh` and `scripts/update.sh` install and enable this timer
automatically (idempotently, so a pod that already has it just gets
re-enabled), a fresh install or a normal in-app/`fs-update` update needs
no extra step. The one path that does NOT wire it up is `ops/deploy.sh` /
`scripts/deploy-dev.sh` (they push code only, not systemd units), so after
using either of those for the first time on a pod, install it by hand:

```bash
# On the Pod (as root):
scp -P 8822 scripts/archive-raw.sh root@<pod>:/home/dac/free-sleep/scripts/
scp -P 8822 scripts/systemd/free-sleep-archive-raw.{service,timer} root@<pod>:/etc/systemd/system/
ssh -p 8822 root@<pod> 'chmod +x /home/dac/free-sleep/scripts/archive-raw.sh \
  && systemctl daemon-reload \
  && systemctl enable --now free-sleep-archive-raw.timer'
```

Verify with `systemctl status free-sleep-archive-raw.timer` (Active: active
(waiting), Trigger in <60 s) and `ls /persistent/free-sleep-data/raw-archive/
| wc -l` (should grow by ~4/hour).

Reverse: `systemctl disable --now free-sleep-archive-raw.timer && rm -rf /persistent/free-sleep-data/raw-archive/`.

### Verifying the optimizations

```bash
# RAM should show ~150-200 MB more available than a stock Pod:
ssh -p 8822 root@<pod> 'free -h | head -2'

# /persistent should be << 1 GB:
ssh -p 8822 root@<pod> 'df -h /persistent | tail -1'

# Capybara should be inactive/disabled:
ssh -p 8822 root@<pod> 'systemctl status capybara || true'

# Single-process node:
ssh -p 8822 root@<pod> 'pstree -p $(systemctl show -p MainPID --value free-sleep)'
```


