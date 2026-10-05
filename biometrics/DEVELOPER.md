# Biometrics code

These notes are for anyone working on the Python code in `biometrics/`, which
turns the Pod's sensor data into presence, vitals (heart rate, HRV and
breathing rate) and sleep records, and on the server jobs that call it.
[BIOMETRICS.md](BIOMETRICS.md) says what the results can and can't tell you,
and [docs/CALIBRATION.md](../docs/CALIBRATION.md) lists the numeric constants
and why each has its value. I test on one Pod 5, with the limits below. Failure
and recovery paths are tested only with simulated failures, not on a real
Pod.

The pipeline, including the vitals code built on HeartPy, comes from upstream
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).
Presence detection, sleep stages, the sleep score and the RAW archive come
from [jmew/free-sleep](https://github.com/jmew/free-sleep). Smaller pieces are
credited where they are described below.

## Where the data comes from

The live stream reads sensor records from the firmware's local NATS JetStream
stream when it can. The scheduled jobs read the `.RAW` files in `/persistent`,
which hold the same records CBOR-encoded. Some newer firmware writes no RAW
files and publishes the records only to that stream: when the RAW and archived
files hold no records for a window, the jobs read it from the stream's own
history instead, bounded by time, record count and size, and fail rather than
return a partial night. The nats-py client ships in `biometrics/vendor` (an
installed copy is used first), so nothing is downloaded for it. I haven't run
this on a Pod with that firmware.

The firmware keeps only a short rolling window of RAW files, about 75 minutes
(jmew/free-sleep's figure; I haven't timed it on my Pod 5), and removes files
after uploading them to Eight Sleep. On some firmware (seen on a Pod 3), uploading is the only
thing that deletes a file, so files pile up while the internet is blocked;
the archive script prunes those too. To keep a full night available,
`scripts/archive-raw.sh` runs on a systemd timer installed by `install.sh`
and hardlinks each new file into `/persistent/free-sleep-data/raw-archive/`,
which keeps 14 days by default and prunes sooner when free space runs low. RAW
files are most reliably available with the
[firewall rules](../INSTALLATION.md#19-add-firewall-rules-to-limit-internet-access)
on.

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
write which isn't fully known: I have seen only `capSense2` on my Pod 5, and
another cover or firmware may write `capSense` (see
[docs/EIGHT_SLEEP_PROTOCOL.md](../docs/EIGHT_SLEEP_PROTOCOL.md#other-pod-generations)).
The new sleep tracking reads both formats through `presence/sensors.py`,
treats `capSense2` on any other model as untested, and runs as on a Pod 5 if
the device label can't be read.

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

About 500 samples a second per sensor, delivered as one record a second. Pod 3
has 2 per side (head and foot), so records contain `left1`, `left2`,
`right1` and `right2`. Pod 4 and Pod 5 have 1 per side, so records contain
only `left1` and `right1`. `StreamProcessor` sets `sensor_count` to 2 when a
record contains `left2` and to 1 otherwise, so layout follows the record, not
the model name.

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

## What runs and when

The scheduled jobs check the Biometrics switch before launching Python. The
Python entry points themselves only log that it's off and continue, and
`POST /api/jobs` has no check, so a run started by hand can still read stored
recordings and write results.

- The live stream, `stream/stream.py`, runs as `free-sleep-stream.service`.
  Once a second it decides whether someone is on each side, and reports
  changes and a heartbeat every 60 frames to `/api/metrics/presence`. While
  someone is present, it writes a row of heart rate, HRV and breathing rate
  to the `vitals` table about once a minute. Breathing rate needs 30 seconds
  of presence before it has a value, and HRV needs 5 minutes; until then the
  row stores 0, which means no reading. With New sleep tracking (beta) on,
  presence comes from the capacitance detector in `presence/` once it is
  ready, and vitals rows then come from `vitals2/`. Until then the default
  estimates are used.
- The nightly analysis runs `sleep_detection/analyze_sleep.py` over a time
  window. With weekly schedules it runs at 12:00 in the Pod's time zone over
  the previous 24 hours and skips a side in away mode. With Rhythms on it
  runs 15 minutes and again 2 hours after each sleep ends, and a side with no
  sleep ending in the preceding 24 hours keeps the noon run. It also runs
  whenever an analysis is requested for a side. Each run widens its window to
  cover any stored night it overlaps, writes `sleep_records` and `movement`
  in one transaction, replacing what it overlaps, and adds a row to
  `analysis_runs` (window, counts, duration, peak memory, outcome). A failed
  write shows as a failed job in System status.
- Calibration runs `sleep_detection/calibrate_sensor_thresholds.py` each
  evening for each side, whether or not daily priming is on. It learns
  the capacitance baseline the nightly analysis uses and records an empty-bed
  piezo floor. Times, look-back and the occupancy check are in
  [CALIBRATION.md](../docs/CALIBRATION.md#what-calibration-does).
- Manual runs (`POST /api/jobs`, from System status): analysis looks back 24
  hours; calibration covers two hours back to one hour ahead with `--force`,
  which skips the occupied-bed check.
- Sleep stages and score are computed by the server when the app asks for
  them (`server/src/routes/metrics/sleepStages.ts` and `sleepScore.ts`).
  Stages come from fixed rules over 5-minute buckets of heart rate, HRV,
  breathing and movement. The app shows neither stages, time asleep (the
  sleep-onset rule starts too late on most nights) nor the score, and uses
  time in bed; both routes stay for API clients. There is no machine
  learning, and neither has been compared with a sleep study.

## Presence detection

This is the vibration-sensor detector, used with New sleep tracking (beta)
off, and for live presence wherever the capacitance detector isn't in use.
`biometric_processor.detect_presence()` runs once a second for each side:

1. It takes the range (98th percentile minus 2nd percentile) of each piezo
   signal on that side, and the larger of the two on a Pod 3.
2. `_PresenceCoordinator` compares the two sides. A side below the noise floor
   (150,000) counts as empty. If both sides are above it, one side must be at
   least 1.3 times the other to count as the only occupied side, so movement
   carried through the mattress doesn't register on the empty side.
3. Entry needs 5 consecutive seconds in which this side is clearly the
   occupied one.
4. Exit is slower. Presence ends after 180 seconds without a clear signal,
   because the piezo sensors respond only to change and a still sleeper's
   small breathing signal can stay below the threshold for a minute or more.
   Sessions shorter than 60 seconds can end after 30 seconds instead, and
   once an exit has started, 3 seconds of clear signal are needed to cancel
   it.
5. When both sides are above the floor and neither is clearly dominant, the
   exit timer normally pauses. The rolling-floor check (`presence_floor.py`)
   lets it keep running when this side's recent low-end signal has dropped
   well below the level it held while occupied, which is what crosstalk from
   the other side looks like; after 600 ambiguous frames it also leaks forward
   slowly. It is set to favor staying present, so it only partly fixes
   crosstalk.
6. On any exit, the side's rolling buffers are cleared (`reset()` and
   `init_tracking()`). After the next entry, vitals resume once `present_for`
   passes `heart_rate_window_seconds`.

The main settings are `no_presence_tolerance` in `BiometricProcessor.__init__`
and `NOISE_THRESHOLD` and `DOMINANCE_RATIO` in `_PresenceCoordinator`; their
values and reasons are in the
[CALIBRATION.md](../docs/CALIBRATION.md#default-live-presence) table. If a
still sleeper shows gaps of hours in their vitals, a likely cause is a signal
below the noise floor running out the exit timer. Raising the tolerance, or
lowering the noise floor for that bed, may help.

## Vitals and missing values

The default live path uses a 3-second heart-rate window, a 30-second
breathing window and a 300-second HRV window. Its acceptance bounds, and the
newer estimators', are in [CALIBRATION.md](../docs/CALIBRATION.md#vitals-filters).
A heart rate outside the HeartPy bounds is dropped, which can leave gaps. A
breathing or HRV update outside its bounds is ignored and the last accepted
average is written again, so a rejection doesn't blank the field. Before the
first accepted update the legacy fields hold 0, meaning no reading.

The newer estimators (`vitals2/`) run only while capacitance presence is
active, and a heart-rate, breathing or HRV window counts only when every
record it reads placed the side in bed, with no reset in between, so HRV
returns five minutes after someone gets back into bed. They sit behind
quality, motion and signal gates. Once the stream has received a pump
frame, a window is kept only when `frzHealth` frames (`pump_speed.py`) show
the pump slow throughout. Times before the first frame, or more than 30
seconds after the newest, have unknown speed and are dropped, logged once.
A stream that has never had a pump frame skips this check and warns once,
so a Pod whose firmware writes no `frzHealth` still gets vitals. A minute gets a row only with an accepted
heart rate. Rows carry `estimator`, `hr_quality`, `rmssd`, `sdnn`,
`hrv_coverage`, `resp_rate` and `resp_quality`, NULL when missing; the legacy
`hrv` and `breathing_rate` columns keep 0 for missing. A quality value is an
algorithm output, not a comparison with a reference device. The Sleep page
shows heart rate and, with New sleep tracking on, `resp_rate`, never HRV, so
the database and API hold values the app doesn't display.

## Code

### Live stream (`stream/`)

`stream.py` reads every sensor record type from the firmware's local NATS
JetStream stream. If NATS isn't available (older firmware or no stream), or
the stream carries no sensor records for two minutes, it reads the newest
`.RAW` file in `/persistent` as well. After 30 minutes without a sensor
record it reports the stream failed, which System status shows as sleep
tracking stopped, and healthy again once data returns. The NATS reader began
as an adaptation of
[SFenton/free-sleep](https://github.com/SFenton/free-sleep/commit/86aba76)
and has since been rewritten; the record decoding and deduplication helpers
it uses came with that port. `stream_processor.py` buffers piezo data and
hands each side's signal to presence detection and the vitals calculations in
`biometric_processor.py`, with helpers in `buffer.py` and `presence_floor.py`.
With New sleep tracking (beta) on, `vitals2_stream.py` writes the per-minute
rows from the newer estimators. Capacitance presence decides which side an
estimate belongs to, including when both sensors pick up the same heartbeat.

### Sleep detection (`sleep_detection/`)

`analyze_sleep.py` loads RAW data for a time range and detects sleep intervals
and movement. `sleep_detector.py` combines piezo and capacitance presence into
sleep sessions. `calibrate_sensor_thresholds.py` learns empty-bed baselines,
and `cap_data.py` loads capacitance data and detects presence from it.

### Vitals (`vitals/`)

`calculate_vitals.py` is kept for reference; it does not run as it is.
`calculations.py` and `run_data.py` hold the signal filtering, the
sliding-window estimates and their runtime parameters, written for
`calculate_vitals.py`. `cleaning.py` interpolates outliers and is shared with
the live stream.

`heart/` is an adapted copy of [HeartPy](https://github.com/paulvangentcom/heartrate_analysis_python)
by Paul van Gent, used for heart rate, HRV and breathing rate. See
[heart/README.md](heart/README.md).

### New sleep tracking (`presence/`, `vitals2/`)

`presence/` is the capacitance presence detector behind New sleep tracking
(beta), shared by the live stream and the nightly analysis. `sensors.py` reads
`capSense` and `capSense2` records into the same three channels per side.
`detector.py` decides each side once a second. `model.py` reads whether the
Pod is a Pod 5 from the hub's device label, as the server does. Here,
`validated` means the format has been tested for presence on a Pod 5; it says
nothing about accuracy. On a format not yet tested, `guard.py` hands presence
and vitals back to the vibration sensor when capacitance can't explain a bed
in use for 10 of 15 minutes.

The detector needs calibrated capacitance baselines on both sides. On an
untested model or format it also needs both sides' learned occupied levels
and a one-second piezo cadence, and there the vibration processors keep
reporting live presence for the bed indicator and auto-off while capacitance
only decides when vitals are recorded. The nightly replay has its own
fallbacks (missing baselines, mixed or unreadable formats, bad cadence, a
rejected reading), so check `sleep_detector.py` rather than assuming it falls
back as the stream does.

`vitals2/` holds the newer heart rate, HRV and breathing estimators, as pure
functions over one side's piezo signal. `gates.py` holds their acceptance
ranges and quality thresholds, and `rows.py` builds the per-minute row.

### Reading RAW files (`load_raw_files.py`)

It loads `.RAW` files, decodes the CBOR records, and pulls out piezo and
capacitance readings, filtered by time range and record type, freeing memory
between files. Each record is read with a small parser (`_read_raw_record`)
instead of `cbor2.load()`, which skips records when cbor2's C extension is
installed. The parser is adapted from throwaway31265/free-sleep pull requests
[#46](https://github.com/throwaway31265/free-sleep/pull/46) by seanpasino and
[#50](https://github.com/throwaway31265/free-sleep/pull/50) by alexuser. It
reads archived RAW files as well as live ones, using the RAW archive from
[jmew/free-sleep](https://github.com/jmew/free-sleep/commit/3ffaa0d) (see
[Where the data comes from](#where-the-data-comes-from)). When a window has
no RAW records, `nats_source.py` reads it from the local JetStream history
through its own read-only consumer and decodes the records the same way.

### Other modules

`db.py` writes vitals (skipping duplicates) and each analysis run's sleep
records and movement together, over one `sqlite3` connection in WAL mode.
`analysis_runs.py` and `calibration.py` record analysis and calibration runs;
all calibration writes go through `calibration.py`, which also writes the
legacy baseline JSON for older readers. `piezo_data.py` loads piezo data for
the scheduled jobs and finds empty-bed periods for calibration. `features.py`
reads the New sleep tracking switch; anything but an exact `true` reads as
off. `vendored.py` makes the packages in `vendor/` (nats-py) importable when
the Pod's Python environment lacks them. `data_types.py` has the `TypedDict`
models.

## Running the jobs on a copy

Both jobs read their data folder from `DATA_FOLDER`
(`/persistent/free-sleep-data/` on the Pod), so they can run against a copy
of `free-sleep.db`, `lowdb/` and `raw-archive/`. They write to it, so keep
the original. `DATA_FOLDER` doesn't redirect the job-health requests the
command-line entry points send to `127.0.0.1:3000`, and the calibrator's
occupancy check asks the same address; to analyze without those, call
`run_analysis` in `analyze_sleep.py` directly. Tests run from the repository
root with `python -m pytest biometrics/__tests__/`; see
[CONTRIBUTING.md](../CONTRIBUTING.md) for the Python version and packages.
Passing them says nothing about accuracy against a reference device.
