# Eight Sleep Pod protocol notes

A consolidated reference for what's been reverse-engineered about the Pod's
local hardware protocol, the `dac.sock` command set, the RAW biometrics
telemetry stream, and a few other odds and ends. This is our own working
notes, cross-checked against other independent reverse-engineering projects
where noted. **Not official, not guaranteed, use at your own risk**, see
[Credits & sources](#credits--sources) for where each piece came from.

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
| 5 | `ALARM_LEFT` | CBOR alarm string | ✅ | Free-sleep uses this actively. Encodes target time (unix ts), duration (seconds), vibration pattern (`double` or `rise`), power level (0-100). |
| 6 | `ALARM_RIGHT` | CBOR alarm string | ✅ | Same shape as 5, right side. |
| 7 | `FORMAT` | ? | ❓ | Commented out, never used or tested. Sounds destructive: do not try without a strong reason and a backup plan. |
| 8 | `SET_SETTINGS` | CBOR settings string | ✅ | Free-sleep uses this actively. Encodes `gl`/`gr` (gain left/right) and `lb` (LED brightness). |
| 9 | `LEFT_TEMP_DURATION` (aka `TURN_ON_LEFT`) | integer seconds | ✅ | Free-sleep uses this to turn a side on/off: `0` = off, `43200` (12h) = on. |
| 10 | `RIGHT_TEMP_DURATION` (aka `TURN_ON_RIGHT`) | integer seconds | ✅ | Same as 9, right side. |
| 11 | `TEMP_LEVEL_LEFT` | integer level, -100..100 | ✅ | Free-sleep uses this actively. Level-to-°F: `82.5 + (level/100) * 27.5`. |
| 12 | `TEMP_LEVEL_RIGHT` | integer level, -100..100 | ✅ | Same as 11, right side. |
| 13 | `PRIME` | none (arg ignored) | ✅ starts, ❌ can't stop | Starts a priming cycle. `isPriming` goes `true` ~10s after the command and clears on its own after ~11-12 minutes: a genuinely long operation, not a quick flush. No known way to stop one early (see [below](#priming-cant-be-cancelled-as-far-as-we-can-tell)). |
| 14 | `DEVICE_STATUS` | none | ✅ | Returns the full status blob: see [DEVICE_STATUS response fields](#device_status-response-fields) below. |
| 15 | n/a | n/a | ❓ | Unused/unknown. Not referenced by free-sleep, jmew, or 8rp. |
| 16 | `ALARM_CLEAR` | none | ✅ | Free-sleep uses this to stop an active alarm vibration. |
| 17 | `STOP_PRIME` | none (arg ignored) | ❌ | Documented by 8rp as stopping an active prime. Tested directly against this pod: sent both immediately and again once priming was confirmed active, `isPriming` stayed `true` for 5+ minutes with no visible effect. May need a different argument or apply only in another context/Pod generation. A "Cancel priming" button built on this was reverted: don't re-add without a positive test. |

### `PRIME` / priming can't be cancelled, as far as we can tell

No known way to stop a priming cycle early:

- Command 17 (`STOP_PRIME` per 8rp) had no observable effect, see above.
- `opensleep`'s lower-level protocol notes (direct STM32 serial, Pod 3)
  list one prime command and no stop/cancel variant.
- `ninesleep` sends `13\n\n` with no argument; a code comment there
  speculates about one but the implementation doesn't use it.

Likely not designed to interrupt mid-cycle, similar to some appliances that
won't cancel a cycle once water is moving. "Prime now" and the daily
auto-prime schedule both still work fine, they just run to completion.
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
| `dismissAlarm` | Purpose unclear | ❓ (8rp docs also mark this unknown) |

## RAW biometrics stream record types

Separate from `dac.sock`, this is the CBOR record stream the pod firmware
writes to `/persistent/*.RAW` (piezo/capacitance/health telemetry), which
free-sleep's biometrics archiver hardlinks into
`/persistent/free-sleep-data/raw-archive/` before the firmware's rolling
buffer truncates it. See `biometrics/load_raw_files.py` and
`biometrics/stream/stream.py`.

| `type` | Contents | Consumed by free-sleep? |
|---|---|---|
| `piezo-dual` | Raw piezo sensor waveform, both sides | ✅ yes: core presence/vitals signal |
| `capSense` (Pod 3) / `capSense2` (Pod 4/5) | Capacitance sensor readings; Pod 5's `capSense2` shape is normalized to the legacy `capSense` fields (`out`/`cen`/`in`) | ✅ yes |
| `bedTemp` (Pod 3, v1 integer centidegrees) / `bedTemp2` (Pod 4/5, float °C, `temps[]` array) | Bed-surface temperature sensors | `bedTemp` yes, `bedTemp2` intentionally not consumed yet (Pod 5 writes `bedTemp2`, kept for a future project) |
| `frzTemp` | `{amb, hs, left, right}`: ambient, heatsink, and per-side hub sensor temps in centidegrees C | ✅ yes: feeds the Settings page sensor-temp display |
| `frzHealth` | `{left, right, fan}`, each side `{tec: {current}, pump: {mode, rpm, water}, temps: {flowrate}}`: see [pump/thermal telemetry](#pumpthermal-telemetry-frzhealth) below | ✅ yes, as of v3.1.0: pump-stall detection only |
| `frzTherm` | `{left, right}`, each either a number or `{target, power, valid, enabled}` | 📖 documented by sleepypod/core, not yet used or verified by us |
| `log` | Firmware's own internal log lines | not consumed |

### Pump/thermal telemetry (`frzHealth`)

Sample decoded from this pod's own RAW archive:

```
{'type': 'frzHealth', 'ts': 1783654226, 'version': 1,
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

This is a real, reported failure mode: a free-sleep user hit 102°F overnight
against an 84°F setpoint, cleared by a power cycle; sleepypod/core
independently documented the same root cause in their ADR 0022. free-sleep
v3.1.0+ watches `frzHealth` for this (TEC actively drawing current + pump
RPM near zero or `water: false`, sustained for a dwell window) and surfaces
it on the Status page as "Pump health." Detection and visibility only,
no automatic power-off, since a safe automatic response is a bigger call
than a detection threshold.

## Adjustable base (BLE)

Separate from everything above, the adjustable base is controlled over
Bluetooth LE via `bluetoothctl`, not `dac.sock`. See
`server/src/8sleep/trimixBaseControl.ts` for the packet format (20-byte
frames, `0xff 0xff 0xff 0xff` header, checksum byte). Not duplicated here;
that file is the source of truth and already has inline documentation.

## Hardware generation detection

Both of free-sleep's Pod-generation heuristics (`detectCoverVersion` and
`detectHubVersion` in `loadDeviceStatus.ts`) are based on a hardware
revision string prefix observed on a Discord thread, not an official spec.
They're marked as guesses in the source and have held up in practice so
far, but treat them as best-effort.

## Credits & sources

- [Schluggi/8rp](https://github.com/Schluggi/8rp), `dac.sock` command
  table and `DEVICE_STATUS` field names.
- [sleepypod/core](https://github.com/sleepypod/core), pump-stall failure
  mode, the `flowrate`-is-temperature correction, `frzHealth`/`frzTherm`
  wire shapes (their ADR 0022).
- [LiamSnow/opensleep](https://github.com/LiamSnow/opensleep), lower-level
  STM32 serial protocol (Pod 3 hardware; not confirmed to match Pod 5).
- [bobobo1618/ninesleep](https://github.com/bobobo1618/ninesleep), cross-
  checked `dac.sock` client implementation.
- Hardware-generation detection heuristics: a Discord thread linked inline
  in `loadDeviceStatus.ts`.

Add new findings here with a source and verification status, worth knowing
whether something was tested or just copied from a doc.
