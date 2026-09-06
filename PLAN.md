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

## Feature roadmap from the official Eight Sleep app (Sep 2026 screenshots)

Data collection is the foundation for all of these — see Phase 0. Presentation
comes after the data layer is trustworthy.

- **Morning brief + push notification**: every morning, a notification
  ("How did you sleep? Recovery 57ms, up 32%") linking to a brief page with a
  headline (e.g. "Deep sleep fell short"), a causal narrative ("deep sleep was
  57m, down 28.7% from baseline, because you went to bed at 10:44pm"), and
  consequences. Thumbs up/down feedback on each insight.
  Delivery: Web Push to the installed PWA (iOS 16.4+) with self-hosted ntfy as
  fallback/secondary channel. Narrative: rule-based insight engine first
  (bedtime shift vs deep-sleep delta, HRV vs baseline, sleep debt), optional
  LLM polish later (local or API, Kris's call — privacy default is rules-only).
- **"Try this tonight" suggestions**: one actionable card per brief, driven by
  the same insight rules (earlier wind-down, cooler mid-night setpoint, etc.).
- **Check-in factor tags**: after notable changes ("what might explain the HRV
  change?") offer quick tags (alcohol, meditation, late meal, exercise, travel,
  custom). Store as a per-day factor log; correlate factors with outcomes over
  time. This is a data source, so it lands early (Phase 0.5).
- **Optimal bedtime window**: computed from historical sleep-onset efficiency
  and deep-sleep share by bedtime; shown as a window (e.g. 9:30–10:00 PM) with
  a "past your bedtime" home state at night.
- **Partner leaderboard**: king bed, two sides — score, time slept, snoring
  (if we can detect it) side-by-side.
- **Performance windows**: circadian-derived daytime Focus/Workout windows from
  wake time + sleep quality.
- **Autopilot-style transparency stats**: nights tracked, temperature
  adjustments made, so the system shows its work.

## Implementation phases

### Phase 0 — collect everything (MAIN FOCUS, before presentation)
Principle: from day one, persist every observable signal, raw where cheap,
derived where raw is too big. Full inventory + constraints in docs/DATA.md.
Build order (from the critic pass): 1) device-state time series,
2) config/plan journal + command audit, 3) materialized nightly stages/scores
+ live presence transitions, 4) discrete event journal, 5) hardware health
(frzHealth rollups + bedTemp room climate), 6) NAS raw offload + per-beat RR
retention. Items 1, 2, 4 in flight as of Sep 5 2026.

### Phase 1 — temperature history recording (server)
Subsumed by Phase 0 item 1 (bed_state_samples/hub_state_samples).
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
