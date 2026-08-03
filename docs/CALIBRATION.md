# Calibration and fixed constants

This codebase leans on numeric constants in several places. They are not all
the same kind of thing, and treating them the same is how a value tuned
against one bed ends up shipped as if it were a law of physics.

Every constant below is one of four kinds:

- **Hardware fact.** Follows from the silicon or the physics. Never learned.
  Must carry a comment explaining why it cannot vary.
- **Timing margin.** A debounce or confirmation window. Fixed, but must state
  the reasoning behind the number.
- **Population bound.** A physiological limit true of people generally.
  Fixed. Values are owned separately from this document.
- **Per-bed learned.** Models this bed, this topper, this sensor's age.
  Belongs in the calibration store.

## Catalog

| File | Constant | Value | Class | Rationale |
|---|---|---|---|---|
| `biometrics/stream/biometric_processor.py` | `NOISE_THRESHOLD` | 150,000 | Per-bed learned | A loaded piezo idles higher. Left idles 80k to 170k against right's 40k to 85k on this pod |
| `biometrics/stream/biometric_processor.py` | `DOMINANCE_RATIO` | 1.3 | Per-bed learned | Cross-side ratio depends on mattress coupling |
| `biometrics/stream/biometric_processor.py` | `_SANE_MAX_SIGNAL` | 25,000,000 | Hardware fact | Anchored to the 24-bit ADC ceiling of 16,777,215; rejects int32 overflow sentinels |
| `biometrics/stream/biometric_processor.py` | `no_presence_tolerance` | 180s | Timing margin | Slow-exit debounce |
| `biometrics/stream/biometric_processor.py` | `_fast_exit_grace` | 30s | Timing margin | Fast-exit debounce |
| `biometrics/stream/biometric_processor.py` | `_established_threshold` | 60s | Timing margin | How long presence must hold before it counts as established |
| `biometrics/stream/biometric_processor.py` | `_REENTRY_CONFIRM_FRAMES` | 3 | Timing margin | Frames of dominance before a mid-exit clock resets |
| `biometrics/stream/biometric_processor.py` | `_presence_heartbeat_interval` | 60s | Timing margin | Contract with the server's `PRESENCE_STALE_MS`; changing one requires changing the other |
| `biometrics/service_health.py` | `_PUMP_RPM_STALL_THRESHOLD` | 200 | Per-bed learned | Derived from this pod's 1900 to 2000 rpm running speed. Reclassify to hardware fact if the figure proves to be pump-revision independent |
| `biometrics/service_health.py` | `_PUMP_TEC_ACTIVE_AMPS` | 1.0 | Per-bed learned | Same provenance as above |
| `biometrics/sleep_detection/cap_data.py` | `min_std` | 1 | Per-bed learned | Measured empty-bed std on Pod 5 is 0.03 to 0.85; the floor sits above it with margin |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `range_threshold` | 80,000 | Per-bed learned | Piezo range gate, same family as `NOISE_THRESHOLD` |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `threshold_range` | 10,000 | Per-bed learned | Stillness gate used to find an empty window |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `threshold_percent` | 0.70 | Timing margin | Fraction of a rolling window that must agree |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `empty_minutes` | 5 | Timing margin | Shortest window worth calibrating from |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `PRESENCE_AUTO_OFF_MS` | 45 min | Timing margin | Safety net for a side left on |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `PRESENCE_STALE_MS` | 5 min | Timing margin | Tolerates five missed 60s heartbeats |
| `server/src/jobs/primeScheduler.ts` | `CALIBRATE_LEFT_HOUR` / `CALIBRATE_RIGHT_HOUR` | 18:30 / 19:00 | Per-bed learned | Chosen because it is reliably empty for one user. Revisit once run history shows whether skips cluster |
| `server/src/8sleep/loadDeviceStatus.ts`, `server/src/routes/deviceStatus/updateDeviceStatus.ts` | 82.5 and 27.5 | | Hardware fact | Level-to-Fahrenheit mapping. Currently inlined in two files rather than shared from one |
| `biometrics/stream/presence_floor.py` | `FLOOR_PERCENTILE` | 20 | Per-bed learned | Low end of the recent-range distribution used as the between-burst floor; part of the same crosstalk-discrimination family as `NOISE_THRESHOLD` and `DOMINANCE_RATIO` |
| `biometrics/stream/presence_floor.py` | `FLOOR_MIN_WINDOW` | 300 samples (~5 min at 1 Hz) | Per-bed learned | How long a rolling floor must accumulate before it is trusted |
| `biometrics/stream/presence_floor.py` | `FLOOR_EMPTY_FRACTION` | 0.30 | Per-bed learned | On a real recording the occupied rolling p20 sat ~2.5M against a ~0.7M crosstalk floor; 0.30 was chosen to catch that gap with margin |
| `biometrics/stream/presence_floor.py` | `FLOOR_EMA_ALPHA` | 0.02 | Per-bed learned | Smoothing rate for the learned per-side occupied-floor reference; slow enough that a momentary still stretch cannot drag it down |
| `biometrics/stream/presence_floor.py` | `AMBIGUOUS_FREEZE_CAP` | 600 frames | Timing margin | Backstop so an inconclusive floor cannot freeze the exit clock forever; set long and slow so a genuinely present sleeper never reaches it |
| `biometrics/stream/presence_floor.py` | `AMBIGUOUS_LEAK_DIVISOR` | 4 | Timing margin | Rate at which the backstop above advances the exit clock once the freeze cap is hit |
| `biometrics/service_health.py` | `SENSOR_TEMPS_UPDATE_INTERVAL` | 30s | Timing margin | Throttles sensor-temperature reporting; frequent enough for health monitoring, infrequent enough to avoid flooding the server |
| `biometrics/service_health.py` | `_PUMP_STALL_DWELL_FRAMES` | 6 frames (~1 min) | Timing margin | frzHealth frames arrive roughly every 10s; 6 consecutive avoids alerting on a single noisy frame |
| `biometrics/service_health.py` | `_PUMP_RECOVERY_DWELL_FRAMES` | 3 frames (~30s) | Timing margin | Same debounce family as the stall threshold above, for clearing rather than raising |
| `biometrics/stream/stream.py` | `STREAM_HEALTH_INTERVAL_SECONDS` | 60s | Timing margin | Heartbeat cadence for the NATS consumer loop, matching the ~60s cadence used elsewhere for biometrics health reporting |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `CHECK_INTERVAL_MS` | 60s | Timing margin | Matches the presence stream's own ~once-a-minute heartbeat; a tighter poll would not see new information between checks |
| `biometrics/vitals/calculations.py`, `biometrics/stream/biometric_processor.py` | `bpmmin` / `bpmmax` | 40 / 90 bpm | Population bound | Plausible resting-to-sleeping heart rate range passed to the heartpy processor; duplicated in both files |
| `biometrics/vitals/calculations.py` | `breathing_lower_threshold` / `breathing_upper_threshold` | 10 / 23 breaths/min | Population bound | Plausible adult breathing-rate range used to discard bad estimates |
| `biometrics/vitals/calculations.py` | `hrv_lower_threshold` / `hrv_upper_threshold` | 10 / 100 ms | Population bound | Plausible SDNN range used to discard bad estimates |
| `biometrics/stream/biometric_processor.py` | live breathing-rate gate | 8 / 20 breaths/min | Population bound | Same purpose as `breathing_lower_threshold`/`breathing_upper_threshold` above but a separate, narrower literal in the live path; the two should probably be reconciled to one source of truth |
| `biometrics/stream/biometric_processor.py` | live HRV gate | 8 / 200 ms | Population bound | Same purpose as `hrv_lower_threshold`/`hrv_upper_threshold` above but a separate, wider literal in the live path; the two should probably be reconciled to one source of truth |

## Which of these are stored today

Only the capSense baseline (`min_std` and the per-sensor mean and std it floors)
is learned and persisted. Everything else in the per-bed learned class is still
a literal in source.
