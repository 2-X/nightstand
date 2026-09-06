# Pod 4 data inventory — what exists, what we keep, what we drop

Generated 2026-09-05 from a 5-agent sweep of this repo (server TS, biometrics
Python, storage/ops) plus opensleep/free-sleep external research. Drives
Phase 0 of PLAN.md: collect everything from day one.

## Every observable source

| Source | Fields | Rate | Persisted today |
|---|---|---|---|
| Franken DEVICE_STATUS (dac.sock, cmd 14) | per-side heat level + target (-100..100 → 55-110°F), heatTime/isOn, waterLevel, priming, tap counters (2x/3x/4x per side), gain, ledBrightness, hubVersion | 2s poll (`frankenMonitor.ts`) | **No** — RAM + WS broadcast, then dropped |
| frzTemp (firmware RAW stream) | ambient, heatsink, left/right water temp (centi-°C) | continuous; 30s throttled POST | **Latest only** (servicesDB.json overwrite) |
| bedTemp (firmware RAW stream) | ambient room temp, humidity, 6-8 bed-surface temps, MCU temp | seconds | **No** — parsed in `load_raw_files.py`, zero consumers |
| frzHealth | pump rpm, TEC current, water flag | ~10s | **No** — reduced to healthy/failed string |
| Raw piezo (.RAW CBOR) | 500Hz x 2 channels ballistocardiogram | 1 rec/s | 36h archive then pruned; firmware deletes at ~75min |
| capSense | 6 pad values (presence/position) | 1Hz | Only inside 36h RAW archive |
| Presence (live, piezo-derived) | per-side present bool + transitions | 1/s decisions, 60s heartbeat | **No** — RAM, lost on restart |
| Vitals | HR, HRV (sdnn), breathing rate | 60s live rows; 3-min batch rows | Yes — SQLite `vitals` |
| Movement | total_movement | 2-min buckets | Yes — SQLite `movement` |
| Sleep records | bed enter/exit, presence intervals | nightly analyze job | Yes — SQLite `sleep_records` |
| Sleep stages / score | computed on-the-fly per HTTP request | on demand | **No** — never materialized; classifier changes rewrite history |
| Per-beat data (heartpy) | RR intervals, rmssd, sdsd, pnn20/50, sd1/sd2, Poincaré, signal quality | every 1s window | **No** — only bpm/sdnn/breathing survive |
| Alarm state | fired at, intensity, pattern, cleared early | event | **No** — memoryDB is RAM despite the name |
| Base position (TriMix BLE) | head/feet angles, per-corner motor ticks, isMoving | continuous while moving | **No** — RAM |
| Tap gestures | double/triple/quad per side | 2s poll diff | **No** — consumed for control, not logged |
| WiFi strength | percent | 10s | **No** |
| Schedules/settings (lowdb JSON) | the *plan*: temps, alarms, power, overrides, away mode | on change | Latest only — **no history of what the plan was** |
| Scheduler firings, manual overrides, /api/execute commands | what actually happened + why | event | Text logs only (45MB rotation, ~days) |
| Ops metrics, reboots, update history | latency, job ok/fail, boot times, versions | various | **No** |

## Known data-quality issues (verified by critic pass)

- `vitals` mixes 60s live rows and 3-min batch rows in one table with mixed
  timestamp semantics; Prisma schema comment claiming 5-min is stale. Batch
  recompute also lacks presence filtering and can hit UNIQUE conflicts.
- Live presence is piezo-only; capsense z-scores are used only offline.
- Raw data capture depends on internet blocked + archive timer alive; NTP is
  lost when blocked (guarded by `isSystemDateValid.ts`).

## Collection plan (priority order, from critic)

1. **Device-state time series** — per-side current/target temp + isOn, plus
   hub row (ambient, heatsink, water, priming, wifi). Fed from the existing
   eventBus `device-status` stream (no new dac.sock callers), written
   on-change with a 60s heartbeat floor.
2. **Config/plan journal + command audit** — append-only log of every
   schedules/settings write, every hardware command (scheduler or user), and
   manual-override events. This is the "plan" half of actual-vs-plan.
3. **Materialized nightly results** — sleep stages, score (+ classifier
   version stamp), presence transitions persisted live.
4. **Event journal** — alarm fired/cleared, prime start/end, power
   transitions, water-low, base moves, taps, reboots. Narrative backbone of
   morning briefs.
5. **Hardware health** — frzHealth 1-min rollups, consume bedTemp records
   (room climate + humidity!). Ground truth for pump-stall failure mode.
6. Later: extend raw retention via NAS offload (rsync + delete, zstd off-pod);
   persist per-beat RR series for real HRV analysis; snore detection from
   piezo; capsense position series.

## Hard constraints (from the risk sweep)

- **Never block the FrankenMonitor 2s loop** (it's the tap-gesture latency
  path). Subscribe to eventBus; fire-and-forget writes, every promise caught
  (an unhandledRejection shuts down the whole server = loses bed control).
- **No new time-series in lowdb** (whole-file rewrite per write + chokidar
  watcher re-triggers job scheduling). SQLite only.
- **SQLite contention**: Node/Prisma + Python share free-sleep.db (WAL, 5s
  busy_timeout; Python only checkpoints at exit). Batch inserts, short
  transactions.
- **Disk**: /persistent ~12-14GB free, deploy blocked below 2GB free. Raw
  piezo is ~645MB/day — cannot retain on-pod. Per-minute samples are ~100-150
  KB/day — fine, but ship retention/rollup with every new table (nothing
  prunes SQLite today).
- **eMMC wear**: prefer batched writes; offload bulk to NAS/SD.
