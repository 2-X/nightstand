# Biometrics

These notes are for anyone working on the Python code in `biometrics/`, which
turns the Pod's sensor data into presence, vitals (heart rate, HRV, and
breathing rate), and sleep records. Limits come first, then what runs and
when, then the code and the sensor data.

The pipeline, including the vitals code built on HeartPy, comes from the
original [throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).
Presence detection, sleep stages, and the sleep score come from
[jmew/free-sleep](https://github.com/jmew/free-sleep). Smaller pieces are
credited below where they are described.

## Limits

- **Accuracy.** Biometrics in free-sleep and its forks, this one included, is
  still early. Heart rate is the only measurement that has been compared with
  reference devices in the [upstream comparison](#upstream-heart-rate-comparison).
  That comparison does not validate Nightstand's later changes. HRV,
  breathing rate, sleep stages and sleep score have not been validated here
  and may be inaccurate.
- **Live estimator acceptance ranges.** Estimates outside these ranges are
  discarded rather than stored: heart rate 40 to 90 bpm, breathing rate 8 to 20 breaths per minute,
  and HRV (SDNN) 8 to 200 ms. Heart-rate estimates above 90 bpm are discarded,
  which can leave gaps. The standalone recomputation script uses different
  breathing/HRV limits; see [the catalog](../docs/CALIBRATION.md).
- **Two sleepers.** Movement on one side reaches the other side's sensor
  through the mattress. Presence detection tries to tell the two apart (see
  [Presence detection](#presence-detection)) but can still be fooled, and any
  vitals written while it is wrong belong to the other person.
- **Still sleepers.** The piezo sensors respond to changes in pressure, not to
  steady weight. A very still sleeper can fall below the detection threshold,
  which leaves gaps in vitals.
- **Pod models.** Pod 3 has two piezo sensors per side; Pod 4 and Pod 5 have
  one. Pod 5's newer cover writes capacitance data in a different format from
  older covers. This fork is developed on a Pod 5; its biometrics have not
  been checked on Pod 3 or Pod 4.
- **Tuning.** Several thresholds were tuned on one or a few beds.
  [docs/CALIBRATION.md](../docs/CALIBRATION.md) lists which constants are
  fixed filters, bed-dependent tuning, rolling estimates or persisted
  calibration.

## Upstream heart-rate comparison

The [original project's comparison](https://github.com/throwaway31265/free-sleep#biometrics)
reports 33 nights from six people, compared mostly against Apple Watches.
The table below reproduces its summary of heart-rate estimates. Nightstand's
later changes, HRV and sleep stages have not been validated here.

| Across 33 nights | Average | Best | Worst |
| --- | --- | --- | --- |
| RMSE (beats per minute) | 2.88 | 1.45 | 7.63 |
| MAE (beats per minute) | 1.83 | 1 | 5.77 |
| Correlation | 80.8% | 95% | 27% |

## What runs and when

Biometrics is off by default. The main [README](../README.md#biometrics)
explains how to install it and turn it on or off. Every job below does
nothing while it is off.

- **Live stream.** `stream/stream.py` runs as `free-sleep-stream.service`. Once
  a second it decides whether someone is on each side and reports that to the
  server (`/api/metrics/presence`). While someone is present, it writes a row
  of heart rate, HRV, and breathing rate to the `vitals` table about once a
  minute. Breathing rate needs 30 seconds of presence before it has a value,
  and HRV needs 5 minutes; until then the row stores 0, which means no
  reading.
- **Sleep analysis.** At 12:00 in the Pod's time zone, and whenever an
  analysis is requested for a side, the server runs
  `sleep_detection/analyze_sleep.py` over a time window (the previous 24
  hours for the daily run). It writes the `sleep_records` and `movement`
  tables in one transaction, replacing records it overlaps and the movement
  bins it recomputes, so running it again over the same night replaces that
  night's records and movement. Movement does not depend on the window
  analysed. Each run adds a row to
  `analysis_runs` with the window, how many sensor rows it read, what it
  wrote, how long it took, its peak memory and its outcome. A failed database
  write shows as a failed job on the Status page. A side in away mode is
  skipped by the daily run.
- **Calibration.** Each evening (left at 18:30, right at 19:00) the server runs
  `sleep_detection/calibrate_sensor_thresholds.py`. It looks back over the
  previous 6 hours for a stretch when the bed was empty, learns the
  capacitance baseline that the daily analysis uses, and records an empty-bed
  piezo floor. It skips the run if someone is on the bed. It runs whether or
  not daily priming is on.
- **Manual runs.** Settings > Pod and diagnostics > System status can run sleep analysis or calibration
  for either side (`POST /api/jobs`). Manual sleep analysis looks back 24
  hours. Manual calibration looks back 2 hours, separately from the scheduled
  6-hour window. It skips the occupied-bed check, so only run it when the bed
  is empty.
- **Off the Pod.** Both jobs read their data folder from `DATA_FOLDER`
  (`/persistent/free-sleep-data/` on the Pod), so they can be run against a
  copy of the database, `lowdb/` and `raw-archive/`.
- **Sleep stages and score** are computed by the server when the app asks for
  them (`server/src/routes/metrics/sleepStages.ts` and `sleepScore.ts`). Stages
  come from fixed rules over 5-minute buckets of heart rate, HRV, and
  movement. There is no machine learning, and the stages have not been
  compared with a sleep study.

## Code

### Live stream (`stream/`)

- `stream.py`: Reads sensor records from the firmware's local NATS JetStream
  stream. If NATS isn't available (older firmware, `nats-py` not installed, or
  no stream), it falls back to watching `/persistent` and reading the newest
  `.RAW` file. The NATS reader is adapted from
  [SFenton/free-sleep](https://github.com/SFenton/free-sleep/commit/86aba76).
- `stream_processor.py`: Buffers piezo data and hands each side's signal to
  presence detection and the vitals calculations.
- `buffer.py`: The rolling sample buffers for the heart rate, breathing, and
  HRV windows.
- `biometric_processor.py`: Presence detection, plus heart rate, HRV, and
  breathing rate for one side. This is where the live vitals are computed.
- `presence_floor.py`: Helpers for the rolling-floor check in presence
  detection.

### Sleep detection (`sleep_detection/`)

- `analyze_sleep.py`: Loads RAW data for a time range and detects sleep
  intervals and movement.
- `calibrate_sensor_thresholds.py`: Learns empty-bed baselines for the
  capacitance and piezo sensors.
- `cap_data.py`: Loads capacitance data and detects presence from it.
- `sleep_detector.py`: Combines piezo and capacitance presence into sleep
  sessions.

### Vitals (`vitals/`)

- `calculate_vitals.py`: A standalone script that recomputes heart rate, HRV,
  and breathing rate for a time range from RAW files. No scheduled job runs
  it.
- `calculations.py` and `run_data.py`: Signal filtering, the sliding-window
  estimates, and their runtime parameters, used by `calculate_vitals.py`.
- `cleaning.py`: Outlier interpolation, shared with the live stream.

`heart/` is an adapted copy of [HeartPy](https://github.com/paulvangentcom/heartrate_analysis_python)
by Paul van Gent, used for heart rate, HRV, and breathing rate. See
[heart/README.md](heart/README.md).

### Reading RAW files (`load_raw_files.py`)

- Loads `.RAW` files, decodes the CBOR records, and pulls out piezo and
  capacitance readings, filtered by time range and record type. Frees memory
  between files.
- Reads each record with a small parser (`_read_raw_record`) instead of
  `cbor2.load()`, which skips records when cbor2's C extension is installed.
  Adapted from throwaway31265/free-sleep pull requests
  [#46](https://github.com/throwaway31265/free-sleep/pull/46) by seanpasino and
  [#50](https://github.com/throwaway31265/free-sleep/pull/50) by alexuser.
- Reads archived RAW files as well as live ones, using the RAW archive from
  [jmew/free-sleep](https://github.com/jmew/free-sleep/commit/3ffaa0d) (see
  [Where the data comes from](#where-the-data-comes-from)).

### Other modules

- `db.py`: Writes vitals (skipping duplicates) and each analysis run's sleep
  records and movement (together, replacing what the run covers). Keeps one
  `sqlite3` connection open, in WAL mode.
- `analysis_runs.py`: Records each sleep analysis run in `analysis_runs`.
- `calibration.py`: Reads and writes the calibration results
  (`calibration_profiles` and `calibration_runs` tables). All calibration
  writes go through it.
- `data_types.py`: `TypedDict` models for the raw records and measurements.
- `piezo_data.py`: Loads piezo data for the daily jobs, detects presence over a
  rolling window, and finds empty-bed periods for calibration.

## Where the data comes from

The live stream reads records from NATS when it can. The daily jobs read the
`.RAW` files in `/persistent`, which hold the same records CBOR-encoded.

The firmware keeps only a short rolling window of RAW files, roughly the last
75 minutes, and removes files after uploading them to Eight Sleep. To keep a
full night available, `scripts/archive-raw.sh` runs on a systemd timer
(installed by `install.sh`) and hardlinks each new file into
`/persistent/free-sleep-data/raw-archive/`, which keeps 14 days by default.
RAW files are most reliably available when the Pod can't reach the internet;
[INSTALLATION.md](../INSTALLATION.md) covers the firewall rules that block
its access.

Each record in a RAW file is a CBOR map of `seq` and `data`, where `data` is
another CBOR-encoded record. On disk, `ts` is in Unix seconds and piezo
samples are packed 32-bit integers. The examples below show records after
`load_raw_files.py` has decoded them, with `ts` as a UTC string.

### Capacitance sensor

Three sensors per side. Older covers write `capSense` records with integer
counts, shown below. Pod 5's newer cover writes `capSense2` records, about two
a second, with 8 values per side in four pairs; `load_raw_files.py` maps the
first three pair means onto the `out`, `cen`, and `in` fields, and the fourth
pair is a reference. That mapping was worked out on a Pod 5. Which models
write which is not fully known: sleepypod reports one Pod 5 on newer firmware
writing `capSense` (see
[docs/EIGHT_SLEEP_PROTOCOL.md](../docs/EIGHT_SLEEP_PROTOCOL.md#other-pod-generations)).
The new sleep tracking reads both formats through `presence/sensors.py`, and
has only been checked on a Pod 5 writing `capSense2`. It reads the model from
the hub's device label, as the server does, and treats `capSense2` on any
other model as unchecked; if the label cannot be read, it runs as on a Pod 5.

```json
{
  "type": "capSense",
  "ts": "2025-01-10 11:00:22",
  "left":  { "out": 387,  "cen": 381,  "in": 505,  "status": "good" },
  "right": { "out": 1076, "cen": 1075, "in": 1074, "status": "good" },
  "seq": 1610679
}
```

### Piezo sensor

About 500 samples a second per sensor, delivered as one record a second. The
number of sensors per side depends on the Pod:

- **Pod 3**: 2 per side (head and foot). Records contain `left1`, `left2`,
  `right1`, and `right2`.
- **Pod 4 and Pod 5**: 1 per side. Records contain only `left1` and `right1`.

`StreamProcessor` sets `sensor_count` to 2 when a record contains `left2` and
to 1 otherwise. With one sensor, presence detection uses that sensor's signal
alone.

A Pod 3 record, with each array shortened (they hold about 500 samples):

```json
{
  "type": "piezo-dual",
  "ts": "2025-01-10 11:00:22",
  "seq": 1610681,
  "adc": 1,
  "freq": 500,
  "gain": 400,
  "left1": [-163532, -161494, ...],
  "left2": [-59995, -63199, ...],
  "right1": [81464, 80593, ...],
  "right2": [722955, 723792, ...]
}
```

## Presence detection

`biometric_processor.detect_presence()` runs once a second for each side:

1. It takes the range (98th percentile minus 2nd percentile) of each piezo
   signal on that side, and the larger of the two on a Pod 3.
2. `_PresenceCoordinator` compares the two sides. A side below the noise floor
   (150,000) counts as empty. If both sides are above it, one side must be at
   least 1.3 times the other to count as the only occupied side, so movement
   carried through the mattress doesn't register on the empty side.
3. Entry needs 5 consecutive seconds in which this side is clearly the
   occupied one.
4. Exit is slower. Presence ends after 180 seconds without a clear signal. The
   piezo sensors only respond to change, so a still sleeper can produce only a
   small breathing signal that stays below the threshold for a minute or more;
   the long timeout covers that. Sessions shorter than 60 seconds can end
   after 30 seconds instead, and once an exit has started, 3 seconds of clear
   signal are needed to cancel it.
5. When both sides are above the floor and neither is clearly dominant, the
   exit timer normally pauses. The rolling-floor check (`presence_floor.py`)
   lets it keep running when this side's recent low-end signal has dropped
   well below the level it held while occupied, which is what crosstalk from
   the other side looks like. It is set to favor staying present, so it only
   partly solves the problem.
6. On any exit, the side's rolling buffers are cleared (`reset()` and
   `init_tracking()`). After the next entry, vitals resume once `present_for`
   passes `heart_rate_window_seconds`.

The main settings are `no_presence_tolerance` (180 seconds) in
`BiometricProcessor.__init__`, and `NOISE_THRESHOLD` and `DOMINANCE_RATIO` in
`_PresenceCoordinator`. If a still sleeper shows gaps of hours in their
vitals, a likely cause is a signal below the noise floor running out the exit
timer. Raising the tolerance, or lowering the noise floor for that bed, may
help.
