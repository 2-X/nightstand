# Eight Sleep Pod protocol notes

A consolidated reference for what's been reverse-engineered about the Pod's
local hardware protocol, the `dac.sock` command set, the RAW biometrics
telemetry stream, and a few other odds and ends. This is our own working
notes, cross-checked against other independent reverse-engineering projects
where noted. These are unofficial notes. See [Credits & sources](#credits--sources)
for the sources; each entry records what was tested.

Every entry below is tagged with a verification status:

- ✅ **Verified against our hardware**, we've sent/read this ourselves and
  confirmed the effect (or read live values from this pod).
- 📖 **Documented elsewhere, not independently verified**, another project
  states this; we haven't tested it ourselves.
- ❌ **Tested, did not work as documented**, we tried it and it didn't do
  what the source claimed, on our hardware (Pod 5) as of the date noted.
- ❓ **Unverified guess**, nobody's confirmed this; it's a plausible name
  based on position/pattern only.

## `dac.sock`, the hardware control socket

Free-sleep's Node server (`server/src/8sleep/frankenServer.ts`, referred to
internally as "Franken") *is* the socket server at `dac.sock`, the pod's own
firmware component connects to it as a client and answers text commands. This
is the same socket Eight Sleep's own `dac` process used to own before
free-sleep replaced it. Protocol: write `<command number>\n\n`, read back a
newline-delimited response.

| # | Name | Args | Status | Notes |
|---|------|------|--------|-------|
| 0 | `HELLO` | none | ✅ | Returns `ok`. Used as a liveness check. |
| 1 | `SET_TEMP` | ? | ❓ | Named by position only; free-sleep doesn't use it: temperature is set via `TEMP_LEVEL_LEFT`/`TEMP_LEVEL_RIGHT` (11/12) instead. |
| 2 | `SET_ALARM` | ? | ❓ | Named by position only; free-sleep uses `ALARM_LEFT`/`ALARM_RIGHT` (5/6) instead. |
| 3 | `REBOOT` | none | 📖 (8rp) | Reboots the device. Free-sleep has this commented out as `RESET` and doesn't call it: the pod's daily reboot schedule reboots at the OS level instead, not through this socket. |
| 4 | `FORCE_RESET` | ? | ❓ | Commented out, never used or tested. |
| 5 | `ALARM_LEFT` | CBOR alarm string | ✅ | Free-sleep uses this actively. Encodes target time (unix ts), duration (seconds), vibration pattern (`double` or `rise`), power level (0-100). Nightstand sends `rise` only when both hub and cover are reported as Pod 5, otherwise `double`, see [other Pod generations](#other-pod-generations). |
| 6 | `ALARM_RIGHT` | CBOR alarm string | ✅ | Same shape as 5, right side. |
| 7 | `FORMAT` | ? | ❓ | Commented out, never used or tested. Sounds destructive: do not try without a strong reason and a backup plan. |
| 8 | `SET_SETTINGS` | CBOR settings string | ✅ | Free-sleep uses this actively. Encodes `gl`/`gr` (gain left/right) and `lb` (LED brightness). |
| 9 | `LEFT_TEMP_DURATION` (aka `TURN_ON_LEFT`) | integer seconds | ✅ | Free-sleep uses this to turn a side on/off: `0` = off, `43200` (12h) = on. |
| 10 | `RIGHT_TEMP_DURATION` (aka `TURN_ON_RIGHT`) | integer seconds | ✅ | Same as 9, right side. |
| 11 | `TEMP_LEVEL_LEFT` | integer level, -100..100 | ✅ | Free-sleep uses this actively. Command transport verified. The app's legacy level-to-°F formula is not the firmware target scale (see below). |
| 12 | `TEMP_LEVEL_RIGHT` | integer level, -100..100 | ✅ | Same as 11, right side. |
| 13 | `PRIME` | none (arg ignored) | ✅ starts, ❌ can't stop | Starts a priming cycle. `isPriming` goes `true` ~10s after the command and clears on its own after ~11-12 minutes: a genuinely long operation, not a quick flush. No known way to stop one early (see [below](#priming-cancellation)). |
| 14 | `DEVICE_STATUS` | none | ✅ | Returns the full status blob: see [DEVICE_STATUS response fields](#device_status-response-fields) below. |
| 15 | n/a | n/a | ❓ | Unused/unknown. Not referenced by free-sleep, jmew, or 8rp. |
| 16 | `ALARM_CLEAR` | none | ✅ | Upstream free-sleep uses this to stop an active alarm vibration. Nightstand dismissal uses a side-specific one-second replacement and sends no `ALARM_CLEAR`. Other projects send a side argument, and a Pod 3 report says it does not stop a running alarm, see [other Pod generations](#other-pod-generations). |
| 17 | `STOP_PRIME` / `ALARM_SOLO` (disputed) | unverified | 📖 unverified, ❌ cancellation on tested Pod 5 | [8rp](https://github.com/Schluggi/8rp/blob/main/docs/commands.md) names it `STOP_PRIME`. [Upstream free-sleep's commented command table](https://github.com/throwaway31265/free-sleep/blob/e5172139874a274d1ced12c8da052ab2cbaa286d/server/src/8sleep/deviceApi.ts#L23) and [seanpasino/free-sleep](https://github.com/seanpasino/free-sleep/commit/50580edff3) name it `ALARM_SOLO`, a whole-bed alarm. Neither meaning is verified in Nightstand. Sent before and after priming was confirmed active on the tested Pod 5, it left `isPriming` true for 5+ minutes with no visible effect. Nightstand does not expose command 17 through its API; do not add a cancellation action without a positive hardware test. |

### Temperature levels and reported targets

Nightstand's `82.5 + (level/100) * 27.5` formula is a legacy display and
command convention, not a verified firmware temperature scale. Saved
Fahrenheit values and outgoing level commands keep that convention.
`frzTherm.target` reports the thermostat target in Celsius, separately from
measured water or mattress temperature.

Offline Pod 5 RAW captures contain 33 target-setting log entries with these
14 distinct pairs. These observations cover one Pod 5, not all generations
or firmware versions.

| Firmware level | Logged target °C | Occurrences |
|---:|---:|---:|
| -100 | 10.00 | 1 |
| -71 | 18.48 | 1 |
| -60 | 19.80 | 1 |
| -49 | 21.12 | 3 |
| -42 | 21.96 | 1 |
| -38 | 22.44 | 2 |
| -31 | 23.28 | 2 |
| -27 | 23.76 | 2 |
| -24 | 24.12 | 3 |
| -20 | 24.60 | 1 |
| -16 | 25.08 | 8 |
| -9 | 25.92 | 2 |
| 2 | 27.36 | 2 |
| 27 | 31.86 | 4 |

The eleven sampled levels from -71 through -9 fit `27 + 0.12 * level` °C;
the two positive sampled levels fit `27 + 0.18 * level` °C. Interpolation,
the breakpoint and the cold-end transition remain inferred. Levels -99
through -72 and above 27 are undetermined. Do not extrapolate these fits
into command conversions. At -100 the observed target is 50°F, while the
legacy display shows 55°F. The worst observed difference is 5°F; the
whole-range error is unknown.

Telemetry corroborates targets through level 2, except that -60 reports
19.790001°C rather than the logged 19.80°C. Its cause is unknown. All four
level-27 logs occur during startup and subsequent thermostats are disabled,
so 31.86°C is a logged conversion, not a confirmed active target.

<a id="priming-cancellation"></a>

### `PRIME` / priming cancellation on the tested Pod 5

Cancellation has not been demonstrated on the tested Pod 5:

- Command 17 (`STOP_PRIME` per 8rp) had no observable effect, see above.
- `opensleep`'s lower-level protocol notes (direct STM32 serial, Pod 3)
  list one prime command and no stop/cancel variant.
- `ninesleep` sends `13\n\n` with no argument; a code comment there
  speculates about one but the implementation doesn't use it.

On the tested Pod 5, "Prime now" and daily priming run to completion.
Other models and firmware may behave differently.
Open a PR if you find a working cancel command.

### `DEVICE_STATUS` response fields

Response is newline-delimited `key = value` text, values as strings.

| Field | Meaning | Status |
|---|---|---|
| `tgHeatLevelL` / `tgHeatLevelR` | Target heat level, -100..100 | ✅ |
| `heatLevelL` / `heatLevelR` | Current heat level, -100..100: **this is the hub sensor reading water temp near the heating element, not a direct bed-surface reading.** See [pump-stall caveat](#pump-stall-can-make-heatlevel-lie) below. | ✅ |
| `heatTimeL` / `heatTimeR` | Seconds remaining until this side auto-shuts-off | ✅ |
| `sensorLabel` | Hardware revision string for the cover sensor; free-sleep parses the 3rd `-`-delimited segment to guess Pod generation (`J00+`→Pod 5, `I00+`→Pod 4, `H00+`→Pod 3) | 📖 sourced from a Discord thread, not an official spec: see `loadDeviceStatus.ts` |
| `waterLevel` | `"true"`/`"false"`: whether the reservoir has enough water | ✅ |
| `priming` | `"true"`/`"false"`: whether a priming cycle is active | ✅ |
| `settings` | Hex-encoded CBOR blob: `gl`/`gr` (gain), `lb` (LED brightness) | ✅ |
| `doubleTap` / `tripleTap` / `quadTap` | JSON string `{l, r, s}`: unix timestamp (or `0`) of the last tap gesture per side/sensor. free-sleep uses `quadTap` to cycle the adjustable-base preset. | ✅ |
| `dismissAlarm` | JSON object keyed by `l` and `r`, with numeric values that upstream free-sleep treats as dismissal timestamps. Nightstand baselines each alarm on its first valid status after starting. The first valid sample after reconnecting can only raise that alarm's high-water mark. Decreases and restored historical values do not dismiss it. Missing or malformed values and the unmapped `s` channel are ignored. Only a later value strictly above the highest seen for that alarm across all connections clears it, without sending a command. | ✅ On my Pod 5, the value rose after a double tap stopped a Nightstand alarm, and Nightstand cleared its ringing state and logged the dismissal. Timestamp units remain unverified. Reading adapted from the [upstream monitor](https://github.com/throwaway31265/free-sleep/blob/a35972d839a68a1a7a78c57085edf7a5a4be314d/server/src/8sleep/frankenMonitor.ts#L350). |

On the tested Pod 5, a double or triple tap during an alarm stops it in the
firmware, regardless of the tap settings. The gesture is not reported to
Nightstand through the tap counters, so the alarm tap action cannot snooze
it. Nightstand clears its ringing record when that side's `dismissAlarm`
value increases beyond the highest value seen for that alarm across all
connections. I confirmed this on my Pod 5 with a double tap during a
Nightstand alarm. There is no verified firmware ringing flag in the status
fields used here.

## RAW biometrics stream record types

Separate from `dac.sock`, this is the CBOR record stream the pod firmware
writes to `/persistent/*.RAW` (piezo/capacitance/health telemetry), which
the RAW archiver (from [jmew/free-sleep](https://github.com/jmew/free-sleep))
hardlinks into
`/persistent/free-sleep-data/raw-archive/` before the firmware's rolling
buffer truncates it. See `biometrics/load_raw_files.py` and
`biometrics/stream/stream.py`.

| `type` | Contents | Consumed by free-sleep? |
|---|---|---|
| `piezo-dual` | Raw piezo sensor waveform, both sides | ✅ yes: core presence/vitals signal |
| `capSense` (Pod 3, possibly some Pod 5) / `capSense2` (Pod 5 newer cover; Pod 4 not confirmed) | Capacitance sensor readings; Pod 5's `capSense2` shape is normalized to the legacy `capSense` fields (`out`/`cen`/`in`) | ✅ yes |
| `bedTemp` (Pod 3, v1 integer centidegrees) / `bedTemp2` (Pod 4/5, float °C, `temps[]` array) | Bed-surface temperature sensors | `bedTemp` yes, `bedTemp2` intentionally not consumed yet (Pod 5 writes `bedTemp2`, kept for a future project) |
| `frzTemp` | `{amb, hs, left, right}`: ambient, heatsink, and per-side hub sensor temps in centidegrees C | ✅ yes: feeds the Settings page sensor-temp display |
| `frzHealth` | `{left, right, fan}`, each side `{tec: {current}, pump: {mode, rpm, water}, temps: {flowrate}}`: see [pump/thermal telemetry](#pumpthermal-telemetry-frzhealth) below | ✅ yes: pump-stall detection and pump-speed checks for the newer vitals estimators |
| `frzTherm` | `{left, right}`, each `{target, power, valid, enabled}` in the observed Pod 5 captures; target is Celsius | ✅ decoded from offline Pod 5 RAW captures; optional target readout and cooling diagnostics |
| `log` | `{type, ts, level, msg}`, firmware's internal messages | Optional allowlisted health feed and dismissal diagnostics; no raw text sent to clients |
| `buttonEvent` | `{type, ts, left/right: {top/bottom: count}}` | Optional diagnostics; observed right-side top and bottom buttons on Pod 5 |
| `tap-gesture` | `{type, ts, side, taps}` | Optional diagnostics only. 📖 [Reported by dallonby](https://github.com/throwaway31265/free-sleep/pull/30), not observed in our Pod 5 captures |

### Pump/thermal telemetry (`frzHealth`)

Decoded `frzHealth` example from a Pod 5, with the timestamp replaced:

```python
{'type': 'frzHealth', 'ts': 0, 'version': 1,
 'left':  {'tec': {'current': 11.99}, 'pump': {'mode': 'pwm', 'rpm': 1928, 'water': True}, 'temps': {'flowrate': 24.94}},
 'right': {'tec': {'current': 7.86},  'pump': {'mode': 'pwm', 'rpm': 2000, 'water': True}, 'temps': {'flowrate': 24.63}},
 'fan': {'top': {'rpm': 414}, 'bottom': {'rpm': 318}}}
```

- `pump.rpm`: healthy/running is ~1900-2000 on this pod; idle/off is exactly
  0 with no ramp. The gap is wide (~1900), so any threshold from ~200-1800
  reliably separates the two states.
- `temps.flowrate`: **this is loop water temperature in °C, not a literal
  flow rate**, it reads ~25°C regardless of pump RPM (matches
  sleepypod/core's ADR 0022, confirmed against this pod's own data). Not
  used for stall detection for that reason, `tec.current` combined with
  `pump.rpm`/`pump.water` is used instead. Potentially useful later for
  clog detection (compare loop temp to bed temp under load).
- `tec.current`: amps the heating/cooling element is drawing. Nonzero means
  actively heating or cooling; near-zero means idle. This can be read as a
  self-contained "is this side commanded active right now" signal without
  needing to cross-reference free-sleep's own on/off state.
- `pump.water`: boolean, appears to be the firmware's own water-flow-sensed
  flag.
- Frame cadence observed: ~1 every 10 seconds.

### Pump-stall can make `heatLevel` lie

The hub water-temperature sensor (`heatLevelL`/`heatLevelR` in
`DEVICE_STATUS`, and `frzTemp`'s `left`/`right`) sits in the same housing as
the heating/cooling element, not in the bed. While the pump circulates, it
reads meaningful moving-water temperature. If the pump stalls while the
element keeps drawing current, the sensor instead reads stagnant water next
to a powered heater, a runaway number that does not reflect actual bed
temperature.

This failure has been reported in practice, with a bed reading 102°F
overnight against an 84°F setpoint until a power cycle cleared it;
sleepypod/core documents the same root cause in their ADR 0022. Nightstand
v3.0.0+ watches `frzHealth` for this (TEC actively drawing current + pump
RPM near zero or `water: false`, sustained for a dwell window) and surfaces
it in Settings > Pod and diagnostics > System status as "Pump health." Detection and visibility only,
no automatic power-off, since a safe automatic response is a bigger call
than a detection threshold.

## Adjustable base (BLE)

Separate from everything above, the adjustable base is controlled over
Bluetooth LE via `bluetoothctl`, not `dac.sock`. See
`server/src/8sleep/trimixBaseControl.ts` for the packet format (20-byte
frames, `0xff 0xff 0xff 0xff` header, a 2-byte checksum). Not duplicated here;
that file is the source of truth and already has inline documentation.

## Hardware generation detection

Both of free-sleep's Pod-generation heuristics (`detectCoverVersion` and
`detectHubVersion` in `loadDeviceStatus.ts`) are based on a hardware
revision string prefix observed on a Discord thread, not an official spec.
They're marked as guesses in the source and have held up in practice so
far, but treat them as best-effort.

<a id="other-pod-generations"></a>

## Other Pod generations

We test on a Pod 5. These notes come from Pod 3 and Pod 4 owners and from
other projects, and none of them has been checked on our hardware.

- 📖 **Alarm pattern.** Pod 3 firmware accepts only `double`: with `rise`
  it answers with an error code and does not vibrate
  ([throwaway31265/free-sleep#55](https://github.com/throwaway31265/free-sleep/issues/55)).
  Pod 4 firmware logs an invalid pattern and falls back to `double`
  ([jmakes/free-sleep](https://github.com/jmakes/free-sleep/commit/9be14cdb)).
  sleepypod's notes say the two patterns feel the same on a Pod 5
  ([sleepypod alarms notes](https://github.com/sleepypod/core/blob/dev/docs/hardware/alarms.md)).
  Nightstand sends the chosen pattern only when both hub and cover are
  reported as Pod 5. It sends `double` for mixed, older or unknown hardware.
  The app offers "Builds up" only when both are reported as Pod 5. Saved
  schedules keep accepting `rise`.
- 📖 **Stopping a running alarm.** On a Pod 3, `ALARM_CLEAR` with the
  argument `empty` produced no firmware log line and the alarm ran its full
  length; re-sending `ALARM_LEFT`/`ALARM_RIGHT` with a duration of 1 second
  replaced the running alarm and stopped it
  ([throwaway31265/free-sleep#54](https://github.com/throwaway31265/free-sleep/issues/54)).
  sleepypod sends `ALARM_CLEAR` with `0` (left) or `1` (right) on a Pod 5
  and notes that a clear sent within about 100 ms of the start cancels the
  alarm before it is felt. Whether the side argument works on a Pod 3 has
  not been tested. Nightstand dismisses a tracked ringing alarm with a
  one-second replacement on that side, without an unscoped clear. Dismissing
  an idle side sends no alarm command. Replacement-only dismissal and partner
  isolation still need physical confirmation on Pod 4 and Pod 5.
  Before release, the owner must authorize and complete a physical Pod 5
  dismissal check: each side ringing alone, both sides ringing with
  dismissal in each direction, dismissal of an idle side, and a subsequent
  alarm. Record the hub, cover and firmware versions and confirm that the
  partner keeps ringing. This is a hardware release gate; mocked command
  assertions do not verify replacement effectiveness or partner isolation.
- 📖 **`SET_SETTINGS` keys.** The firmware reads only the two-letter keys
  `v`, `gl`, `gr` and `lb`, and a write changes only the keys it contains
  (sleepypod, Pod 5,
  [sleepypod/core#607](https://github.com/sleepypod/core/pull/607)).
  On a Pod 3, [ninesleep](https://github.com/bobobo1618/ninesleep) sets
  the light by sending `lb` on its own. opensleep describes the
  Pod 3 light as an I2C LED driver that other firmware processes also
  write to
  ([opensleep background](https://github.com/LiamSnow/opensleep/blob/main/BACKGROUND.md)),
  so a brightness write may be overridden. Reading `settings` back from
  `DEVICE_STATUS` shows whether a write took.
- 📖 **Capacitance scale.** Pod 3 `capSense` reports three integer channels
  per side, and someone getting into bed moves them by hundreds. Pod 5
  `capSense2` values move by about 5 to 20
  ([sleepypod sensor profiles](https://github.com/sleepypod/core/blob/dev/docs/hardware/sensor-profiles.md)).
  Nightstand's presence thresholds were checked against Pod 5 data only.
- 📖 **Which capacitance format.** sleepypod's notes tie `capSense2` to the
  newer Pod 5 cover and report one Pod 5 on newer firmware writing `capSense`
  ([sleepypod sensor profiles](https://github.com/sleepypod/core/blob/main/docs/hardware/sensor-profiles.md),
  [NATS frame notes](https://github.com/sleepypod/core/blob/main/docs/nats-frame-readers.md)).
  We have not found a published Pod 4 capture of either. Nightstand
  therefore reads the format from the records and treats anything but
  `capSense2` on a Pod 5 as experimental. On `capSense` its new sleep tracking
  starts from sleepypod's `capSense` entry level of 300 counts
  ([sleepypod sleep detector](https://github.com/sleepypod/core/blob/main/docs/sleep-detector.md))
  and then learns each side's own level.
- 📖 **Files the firmware keeps in `/persistent`.** Pod 3 firmware reads
  `frozen.heartbeat` relative to its working directory; moving it made the
  firmware reload every 30 seconds and leak file descriptors
  ([sleepypod/core#690](https://github.com/sleepypod/core/issues/690)).
  Leave `SEQNO.RAW`, `frozen.heartbeat`, `alarm.cbr` and `uptime.log` in
  place when cleaning up RAW files.
- 📖 **Firmware without RAW files.** Firmware from about April 2026 writes
  sensor data to a NATS JetStream stream and creates no `.RAW` files
  ([sleepypod ADR 0018](https://github.com/sleepypod/core/blob/dev/docs/adr/0018-tmpfs-raw-frames.md)).

## Credits & sources

- [Schluggi/8rp](https://github.com/Schluggi/8rp), `dac.sock` command
  table and `DEVICE_STATUS` field names.
- [sleepypod/core](https://github.com/sleepypod/core), pump-stall failure
  mode, the `flowrate`-is-temperature correction, `frzHealth`/`frzTherm`
  wire shapes (their ADR 0022), and the Pod 5 alarm, `SET_SETTINGS`,
  capacitance, `/persistent` and RAW-less firmware notes under
  [other Pod generations](#other-pod-generations).
- [LiamSnow/opensleep](https://github.com/LiamSnow/opensleep), lower-level
  STM32 serial protocol (Pod 3 hardware; not confirmed to match Pod 5) and
  the Pod 3 light driver notes.
- [bobobo1618/ninesleep](https://github.com/bobobo1618/ninesleep), cross-
  checked `dac.sock` client implementation.
- [caseyWebb](https://github.com/caseyWebb), Pod 3 alarm findings in
  throwaway31265/free-sleep#54 and #55.
- [jmakes/free-sleep](https://github.com/jmakes/free-sleep), Pod 4 alarm
  pattern behavior.
- Hardware-generation detection heuristics: a Discord thread linked inline
  in `loadDeviceStatus.ts`.
- [jmew/free-sleep](https://github.com/jmew/free-sleep/commit/3ffaa0d), the
  RAW-file archive that keeps overnight data past the firmware's rolling
  buffer.

Add new findings here with a source and verification status, worth knowing
whether something was tested or just copied from a doc.
