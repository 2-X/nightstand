# Night-plan fork roadmap

Kris's fork of Nightstand (upstream: LTimothy/Nightstand, itself a fork of
throwaway31265/free-sleep). Target hardware: Pod 4 hub, king cover, pure-black UI.

Design reference conversation: chez-claude session 2026-09-05. Mockup: dark
"Tonight" view with actual-vs-projected temperature curve, sleep-stage strip,
and a flexible alarm list.

## Goals

1. **Tonight page** (new default landing page)
   - Live chart: actual bed temperature so far (solid) + projected rest-of-night
     schedule curve (dashed) + alarm markers + "now" cursor.
   - Sleep-stage strip under the chart once stages are available for the night.
   - Live updates over the existing `/ws/events` WebSocket (`device-status` channel).
2. **Unlimited alarms with arbitrary cadence**
   - Remove `MAX_ALARMS_PER_DAY = 10` cap.
   - Recurrence model per alarm: `daily | weekdays | weekends | customDays[] |
     interval (every N days from anchor date)`.
   - Weekday/weekend split as a first-class toggle in the editor.
   - Optional per-alarm warm-ramp lead time (start warming N minutes before).
3. **Night history visualization** (v3rm0n-style)
   - Per-night view: temperature actually delivered vs plan, HR/HRV/breathing
     overlays, presence/exit events, stage bands.
   - Requires new temperature history recording (see below).
4. **Pure black everywhere** — upstream is already `#000` base; audit remaining
   surfaces (`app/src/theme.ts`, `app/src/design/tokens.ts`) for stray grays.

## Key architectural facts (from code exploration)

- App: React 18 + MUI v7 + @mui/x-charts + Zustand + React Query, Vite.
  Routes in `app/src/AppRoutes.tsx`. Charts wrap `app/src/design/TimeSeriesChart.tsx`.
- Server: Express + node-schedule. Schedules/alarms in LowDB JSON
  (`server/src/db/schedulesSchema.ts`, jobs in `server/src/jobs/alarmScheduler.ts`
  and `jobScheduler.ts` which watches schedulesDB.json and rebuilds jobs).
- Metrics: Prisma SQLite (`server/prisma/schema.prisma`) — models `vitals`,
  `sleep_records`, `movement`, calibration. 5-minute epochs, Unix-second timestamps.
- WebSocket `/ws/events`: `device-status` (full snapshot on change, 2s poll when
  clients connected), `service-health`, `job-event`.
- **Gap:** actual temperature is never persisted. `device-status` snapshots include
  `sensorTemps` (ambient/heatsink/bed) and current side temps but nothing writes
  them to SQLite.

## Implementation phases

### Phase 1 — temperature history recording (server)
- New Prisma model `temperature_history(id, side, timestamp, target_temp_f,
  actual_temp_f, ambient_temp_f, heating|cooling state)` indexed on (side, timestamp).
- Sampler hooks into FrankenMonitor's existing poll loop; write one row per side
  per minute (only while power is on, dedupe unchanged consecutive rows if needed).
- New route `GET /api/metrics/temperature?side&startTime&endTime`.

### Phase 2 — alarm recurrence engine (server)
- Extend `schedulesSchema.ts`: alarms become a top-level list per side (not
  per-day), each with `{time, recurrence, vibration settings, warmRampMinutes?}`.
- Migration shim: read old per-day alarms into the new shape on first load.
- Rewrite `alarmScheduler.ts` to expand recurrence rules into node-schedule
  RecurrenceRules; keep the DST dedup logic.
- Warm ramp: for each alarm occurrence, schedule a temperature job at
  `time - warmRampMinutes` stepping toward wake temp.

### Phase 3 — Tonight page (app)
- `app/src/pages/TonightPage/` with the chart; route `/` (move current
  ControlTempPage to `/control`, keep its slider embedded below the chart).
- Projection = remaining schedule curve for tonight's side; actual = new
  temperature history endpoint + live WS ticks appended client-side.
- Alarm markers from the recurrence engine's "next occurrences" endpoint
  (`GET /api/alarms/upcoming?hours=12`).

### Phase 4 — night history page (app)
- Extend `app/src/pages/DataPage/SleepPage/` with a `NightOverviewCard`:
  temp actual-vs-plan + vitals overlays + stage bands per selected night.

### Phase 5 (later) — smarter curves
- Tier 1 ships implicitly (multi-point schedule = physiological baseline curve).
- Tier 2: stage-responsive nudges from the Python biometrics service
  (`biometrics/sleep_detection/`) — cool into deep sleep, hold during REM.
- Tier 3: night-over-night outer loop (adjust cool-phase depth based on prior
  night's deep-sleep share). Treat pod HRV/breathing as trends only (unvalidated).

## Dev workflow

- App against live pod: `cd app && VITE_ENV=dev VITE_POD_IP=<pod-ip> npm run dev`
- App standalone with mocks: `npm run build:demo` / MSW handlers.
- Server local stub mode: `cd server && npm run dev:local`.
- Deploy to pod: `scripts/deploy-dev.sh` (see INSTALLATION.md).
- Keep upstream syncable: `git fetch upstream && git merge upstream/main`;
  prefer additive files over editing shared ones where practical.
