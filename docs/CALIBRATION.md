# Calibration and fixed constants

This codebase leans on numeric constants in several places. They are not all
the same kind of thing, and treating them the same is how a value tuned
against one bed ends up shipped as if it were a law of physics.

The class describes why a value exists, not whether it is learned today:

- **Hardware fact.** Follows from the silicon or the physics. Never learned.
  Must carry a comment explaining why it cannot vary.
- **Timing margin.** A debounce or confirmation window. Fixed, but must state
  the reasoning behind the number.
- **Estimator acceptance range.** A filter chosen by the algorithm. Estimates
  outside it are discarded, which can leave missing data. It is not a
  universal physiological limit.
- **Bed-dependent tuning.** Depends on the bed, topper or sensor. Most of these
  values are fixed literals today; learning them is a possible future change.

## Catalog

| File | Constant | Value | Class | Current implementation | Rationale |
|---|---|---|---|---|---|
| `biometrics/stream/biometric_processor.py` | `NOISE_THRESHOLD` | 150,000 | Bed-dependent tuning | Fixed literal | An empty side idles 40k to 110k on this pod; occupied jumps to 200k and above, even on the off side via mattress transmission. 150k keeps a 25% margin below the weakest occupied signal |
| `biometrics/stream/biometric_processor.py` | `DOMINANCE_RATIO` | 1.3 | Bed-dependent tuning | Fixed literal | Cross-side ratio depends on mattress coupling |
| `biometrics/stream/biometric_processor.py` | `_SANE_MAX_SIGNAL` | 25,000,000 | Hardware fact | Fixed literal | Anchored to the 24-bit ADC ceiling of 16,777,215; rejects int32 overflow sentinels |
| `biometrics/stream/biometric_processor.py` | `no_presence_tolerance` | 180s | Timing margin | Fixed literal | Slow-exit debounce |
| `biometrics/stream/biometric_processor.py` | `_fast_exit_grace` | 30s | Timing margin | Fixed literal | Fast-exit debounce |
| `biometrics/stream/biometric_processor.py` | `_established_threshold` | 60s | Timing margin | Fixed literal | How long presence must hold before it counts as established |
| `biometrics/stream/biometric_processor.py` | `_REENTRY_CONFIRM_FRAMES` | 3 | Timing margin | Fixed literal | Frames of dominance before a mid-exit clock resets |
| `biometrics/stream/biometric_processor.py` | `_presence_heartbeat_interval` | 60s | Timing margin | Fixed literal | Contract with the server's `PRESENCE_STALE_MS`; changing one requires changing the other |
| `biometrics/service_health.py` | `_PUMP_RPM_STALL_THRESHOLD` | 200 | Bed-dependent tuning | Fixed literal | Derived from this pod's 1900 to 2000 rpm running speed. Reclassify to hardware fact if the figure proves to be pump-revision independent |
| `biometrics/service_health.py` | `_PUMP_TEC_ACTIVE_AMPS` | 1.0 | Bed-dependent tuning | Fixed literal | Same provenance as above |
| `biometrics/sleep_detection/cap_data.py` | `min_std` | 1 | Bed-dependent tuning | Fixed literal | Measured empty-bed std on Pod 5 is 0.03 to 0.85; the floor sits above it with margin |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `range_threshold` | 80,000 | Bed-dependent tuning | Fixed literal | Piezo range gate related to `NOISE_THRESHOLD` |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `threshold_range` | 10,000 | Bed-dependent tuning | Fixed literal | Stillness gate used to find an empty window |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `threshold_percent` | 0.70 | Timing margin | Fixed literal | Fraction of a rolling window that must agree |
| `biometrics/sleep_detection/calibrate_sensor_thresholds.py` | `empty_minutes` | 5 | Timing margin | Fixed literal | Shortest window worth calibrating from |
| `biometrics/sleep_detection/sleep_detector.py` | `detect_presence_cap` call's `occupancy_threshold` | 5 | Bed-dependent tuning | Fixed literal | Gate on the z-score sum computed against the per-bed cap baseline this work stores. Overrides `detect_presence_cap`'s own default of 50 with no rationale given at the call site; likely tuned to this pod's much smaller capSense2 z-score denominators (see the `min_std` note above), but that is not stated in code. Revisit to confirm and document, or restore the shared default |
| `biometrics/sleep_detection/sleep_detector.py` | `detect_presence_cap` call's `threshold_percent` | 0.90 | Timing margin | Fixed literal | Fraction of a 10s rolling window that must read occupied before live cap presence latches; tighter than the calibrator's own 0.70 for the same rolling-window mechanism, since a false cap positive here directly compounds with piezo in `build_sleep_records`'s OR |
| `biometrics/sleep_detection/sleep_detector.py` | `detect_presence_piezo_p2p` call's `threshold_percent` | 0.70 | Timing margin | Fixed literal | Same value and purpose as `calibrate_sensor_thresholds.py`'s `threshold_percent`, applied here to the p2p piezo detector used for sleep-record building instead of calibration |
| `biometrics/sleep_detection/sleep_detector.py` | `detect_presence_piezo_p2p` call's `noise_threshold` | 150,000 | Bed-dependent tuning | Fixed literal | A second copy of `biometric_processor.py`'s `NOISE_THRESHOLD`, passed explicitly here even though it matches that function's own default. The two literals should be reconciled to one source of truth rather than read as independently derived |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `PRESENCE_AUTO_OFF_MS` | 45 min | Timing margin | Fixed literal | Safety net for a side left on |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `PRESENCE_STALE_MS` | 5 min | Timing margin | Fixed literal | Tolerates five missed 60s heartbeats |
| `server/src/jobs/primeScheduler.ts` | `CALIBRATE_LEFT_HOUR` / `CALIBRATE_RIGHT_HOUR` | 18:30 / 19:00 | Timing margin | Fixed literal | A household schedule choice, not sensor physics: chosen because it is reliably empty for one user at that hour. Owned per household, not per bed; revisit once run history shows whether skips cluster |
| `server/src/8sleep/loadDeviceStatus.ts`, `server/src/routes/deviceStatus/updateDeviceStatus.ts` | Level-to-Fahrenheit conversion | 82.5 and 27.5 | Hardware fact | Fixed literal | Maps temperature levels to Fahrenheit; inlined in both files |
| `biometrics/stream/presence_floor.py` | `FLOOR_PERCENTILE` | 20 | Bed-dependent tuning | Fixed literal | Low end of the recent-range distribution used as the between-burst floor; helps distinguish crosstalk alongside `NOISE_THRESHOLD` and `DOMINANCE_RATIO` |
| `biometrics/stream/presence_floor.py` | `FLOOR_MIN_WINDOW` | 300 samples (~5 min at 1 Hz) | Bed-dependent tuning | Fixed literal | How long a rolling floor must accumulate before it is trusted |
| `biometrics/stream/presence_floor.py` | `FLOOR_EMPTY_FRACTION` | 0.30 | Bed-dependent tuning | Fixed literal | On a real recording the occupied rolling p20 sat ~2.5M against a ~0.7M crosstalk floor; 0.30 was chosen to catch that gap with margin |
| `biometrics/stream/presence_floor.py` | `FLOOR_EMA_ALPHA` | 0.02 | Bed-dependent tuning | Fixed literal | Smoothing rate for the learned per-side occupied-floor reference; slow enough that a momentary still stretch cannot drag it down |
| `biometrics/stream/presence_floor.py` | `AMBIGUOUS_FREEZE_CAP` | 600 frames | Timing margin | Fixed literal | Backstop so an inconclusive floor cannot freeze the exit clock forever; set long and slow so a genuinely present sleeper never reaches it |
| `biometrics/stream/presence_floor.py` | `AMBIGUOUS_LEAK_DIVISOR` | 4 | Timing margin | Fixed literal | Rate at which the backstop above advances the exit clock once the freeze cap is hit |
| `biometrics/service_health.py` | `SENSOR_TEMPS_UPDATE_INTERVAL` | 30s | Timing margin | Fixed literal | Throttles sensor-temperature reporting; frequent enough for health monitoring, infrequent enough to avoid flooding the server |
| `biometrics/service_health.py` | `_PUMP_STALL_DWELL_FRAMES` | 6 frames (~1 min) | Timing margin | Fixed literal | frzHealth frames arrive roughly every 10s; 6 consecutive avoids alerting on a single noisy frame |
| `biometrics/service_health.py` | `_PUMP_RECOVERY_DWELL_FRAMES` | 3 frames (~30s) | Timing margin | Fixed literal | Consecutive frames required to clear a stall alert |
| `biometrics/stream/stream.py` | `STREAM_HEALTH_INTERVAL_SECONDS` | 60s | Timing margin | Fixed literal | Heartbeat cadence for the NATS consumer loop, matching the ~60s cadence used elsewhere for biometrics health reporting |
| `server/src/8sleep/presenceAutoOffMonitor.ts` | `CHECK_INTERVAL_MS` | 60s | Timing margin | Fixed literal | Matches the presence stream's own ~once-a-minute heartbeat; a tighter poll would not see new information between checks |
| `biometrics/vitals/calculations.py`, `biometrics/stream/biometric_processor.py` | `bpmmin` / `bpmmax` | 40 / 90 bpm | Estimator acceptance range | Fixed literal | Plausible resting-to-sleeping heart rate range passed to the heartpy processor; duplicated in both files |
| `biometrics/vitals/calculations.py` | `breathing_lower_threshold` / `breathing_upper_threshold` | 10 / 23 breaths/min | Estimator acceptance range | Fixed literal | Plausible adult breathing-rate range used to discard bad estimates |
| `biometrics/vitals/calculations.py` | `hrv_lower_threshold` / `hrv_upper_threshold` | 10 / 100 ms | Estimator acceptance range | Fixed literal | Plausible SDNN range used to discard bad estimates |
| `biometrics/stream/biometric_processor.py` | live breathing-rate gate | 8 / 20 breaths/min | Estimator acceptance range | Fixed literal | Same purpose as `breathing_lower_threshold`/`breathing_upper_threshold` above but a separate, narrower literal in the live path; the two should probably be reconciled to one source of truth |
| `biometrics/stream/biometric_processor.py` | live HRV gate | 8 / 200 ms | Estimator acceptance range | Fixed literal | Same purpose as `hrv_lower_threshold`/`hrv_upper_threshold` above but a separate, wider literal in the live path; the two should probably be reconciled to one source of truth |
| `biometrics/presence/sensors.py` | `CAPSENSE.unit` | 75 | Bed-dependent tuning | Fixed literal | Converts the new detector's fixed capacitance levels from `capSense2` units to `capSense` counts, giving a starting entry level of 300 counts, which matches sleepypod's published `capSense` entry threshold. Not checked on a Pod that writes `capSense`; each side's learned level takes over after its first good night |
| `biometrics/presence/guard.py` | `UNEXPLAINED_SECONDS` of `UNEXPLAINED_WINDOW_SECONDS` | 600 of 900 | Timing margin | Fixed literal | On a capacitance format not yet checked, the vibration sensor takes back deciding when vitals are recorded after the bed reads in use for 10 of 15 minutes with nobody placed in it by capacitance. Live presence (the in-bed indicator and presence auto-off) stays on the vibration sensor on those formats either way. Longer than any entry, much shorter than the 45 minute auto-off |
| `biometrics/presence/piezo.py` | `ONE_PER_SECOND_SHARE` | 0.9 | Timing margin | Fixed literal | The presence detector counts piezo records as seconds; on a format not yet checked, the new tracking runs only when at least 90% of record steps are one second |

## Estimates and calibration stored today

Pump health appears under Settings > Pod and diagnostics > System status.

| Value | Current implementation | Persistence |
| --- | --- | --- |
| Per-sensor capacitance mean and standard deviation | Persisted calibration from an empty-bed window | SQLite calibration profile; legacy baseline JSON also written for rollback compatibility |
| Empty-bed piezo floor | Persisted calibration from an empty-bed window | Recorded by the calibration job; not a replacement for the live fixed noise threshold |
| Recent piezo floor and occupied-floor reference | Rolling estimate using the fixed parameters above | In-memory stream state |

`min_std` is a fixed literal that floors the measured capacitance standard
deviation; the floor itself is not learned. The `FLOOR_*` constants are also
fixed even though they parameterize a rolling estimate. The class column
records provenance and tuning needs, not an implemented calibration roadmap.
