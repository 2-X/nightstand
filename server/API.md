# API Endpoints

The server exposes RESTful endpoints for interaction. All responses are JSON unless noted otherwise.

There is no login. A device that can reach the Pod, locally or over Tailscale,
can control it and access its data. Use a trusted network, do not port-forward
this API to the public internet, and restrict remote access.

HTTP requests and WebSocket upgrades use the same Origin filter. It accepts
HTTP(S) origins with exact loopback hosts (`localhost`, `127.0.0.1`, `[::1]`),
single-label `.local` hosts, or IPv4 addresses matching a /24 prefix of a
non-internal server interface. `ALLOWED_ORIGIN` can add one configured origin;
`*` disables this filtering. An origin cannot contain credentials, a path,
query or fragment. Requests without an Origin header are allowed, so this
filter is not authentication or protection from non-browser clients.

---

## `/api/deviceStatus`

### GET

- Retrieves the current status of the device. Returns 503 while Franken (the hardware socket) is still connecting on a cold start, or if a command times out.

#### Response

```json
{
  "left": {
    "currentTemperatureLevel": -43,
    "currentTemperatureF": 71,
    "targetTemperatureF": 64,
    "secondsRemaining": 0,
    "isOn": false,
    "isAlarmVibrating": false,
    "taps": { "doubleTap": 0, "tripleTap": 0, "quadTap": 0 }
  },
  "right": {
    "currentTemperatureLevel": -47,
    "currentTemperatureF": 70,
    "targetTemperatureF": 64,
    "secondsRemaining": 0,
    "isOn": false,
    "isAlarmVibrating": false
  },
  "coverVersion": "Pod 3",
  "hubVersion": "Pod 3",
  "freeSleep": {
    "version": "1.0.0",
    "branch": "main"
  },
  "waterLevel": "true",
  "isPriming": false,
  "settings": {
    "v": 1,
    "gainLeft": 400,
    "gainRight": 400,
    "ledBrightness": 0
  },
  "wifiStrength": 52,
  "sensorTemps": {
    "ambientC": 22.5,
    "ambientF": 73,
    "heatsinkC": 31.2,
    "leftC": 24.1,
    "rightC": 23.8,
    "lastUpdated": "2026-04-26T10:12:34Z"
  }
}
```

`taps` (per side, optional) counts double/triple/quad-tap gestures detected since the last reset. `sensorTemps` is null until the biometrics service has reported ambient/heatsink/side temperatures at least once; it is not available on every pod.

### POST

- Updates the device; send only the fields you want to change. Returns `204 No Content` on success.
- Returns 503 if the hardware connection is not back within 10 seconds or a command gets no answer. A command that failed this way is dropped, never sent later when the connection returns. `/api/execute` behaves the same. Scheduled alarms follow the same rule: one that could only start more than 3 minutes after its time is skipped. Scheduled power and set point changes are the exception: they wait for the hardware for as long as it takes, and when several changes for the same setting are waiting, only the newest is sent.

#### Request Body

```json
{
  "left": {
    "targetTemperatureF": 88,
    "isOn": true
  },
  "right": {
    "targetTemperatureF": 90,
    "isOn": false
  },
  "isPriming": true
}
```

`targetTemperatureF` must be 55-110, `secondsRemaining` a whole number of seconds from 0 to 43200, `settings.ledBrightness` a whole number from 0 to 100, and `settings.v`, `settings.gainLeft` and `settings.gainRight` whole numbers from 0 to 2147483647. Out-of-range values and unknown keys return 400 and nothing is sent to the Pod. Read-only fields from the GET response (such as `currentTemperatureF` or `waterLevel`) are accepted and ignored. Setting a side's `targetTemperatureF` pauses that side's remaining temperature schedule for the rest of the day (see `scheduleOverride`).

---

## `/api/settings`

### GET

- Retrieves the current settings of the system.

#### Response

```json
{
  "id": "d07caf20-4f6a-4a9b-be8e-012989b0a65f",
  "timeZone": "America/Los_Angeles",
  "temperatureFormat": "fahrenheit",
  "rebootDaily": true,
  "rawArchiveRetentionDays": 14,
  "updateChannel": "stable",
  "left": {
    "name": "Left",
    "awayMode": false,
    "alarmsEnabled": true,
    "scheduleOverrides": {
      "temperatureSchedules": { "disabled": false, "expiresAt": "" },
      "alarm": { "disabled": false, "timeOverride": "", "expiresAt": "" },
      "pause": { "active": false, "expiresAt": "" }
    },
    "oneOffAlarm": {
      "enabled": false,
      "fireAt": "",
      "vibrationIntensity": 100,
      "vibrationPattern": "rise",
      "duration": 30
    },
    "taps": {
      "doubleTap": { "type": "temperature", "change": "decrement", "amount": 2 },
      "tripleTap": { "type": "temperature", "change": "increment", "amount": 2 },
      "quadTap": { "type": "base_control", "behavior": "toggle_preset" }
    }
  },
  "right": { "...": "same shape as left" },
  "primePodDaily": {
    "enabled": true,
    "time": "14:00"
  },
  "features": {
    "sleepScore": true,
    "levelTemps": true,
    "oneOffAlarms": true,
    "presenceAutoOff": true,
    "nightstandTheme": true,
    "rhythms": false,
    "biometricsV2": false
  }
}
```

- `temperatureFormat` is `fahrenheit`, `celsius`, or `level` (the -10..+10 scale the official Pod app uses; all three map to the same underlying Fahrenheit value).
- `updateChannel` is `stable` or `beta` and controls which releases the in-app updater treats as available.
- `rawArchiveRetentionDays` (1 to 60, default 14) is how long the pod keeps raw sensor recordings. Changing it rewrites `raw-archive.conf` in the data folder, which `scripts/archive-raw.sh` reads.
- `oneOffAlarm` is a single alarm that fires once at `fireAt` (an ISO 8601 datetime with offset) then disables itself, independent of the recurring per-day schedule in `/api/schedules`.
- `scheduleOverrides.pause` pauses one side's schedule. While `active`, that side's scheduled power, temperature and recurring alarm jobs are skipped when they come due, and presence auto-off leaves the side alone. The one-time alarm is not affected by the pause, so it rings if the side is on. `expiresAt` is an ISO 8601 datetime with offset, at most 14 days ahead, or `""` to pause until the side is resumed. When `expiresAt` passes, the server clears the pause itself and does not switch the side on or off at that moment.
- `taps` maps each gesture (`doubleTap`/`tripleTap`/`quadTap`) to a `temperature`, `alarm`, or `base_control` action.
- `features` are runtime feature flags read by the app. `features.rhythms` is the Rhythms switch (see `/api/rhythms` below); it changes only through `POST /api/rhythms/enable` and `POST /api/rhythms/disable`.

### POST

- Updates system settings; send only the fields you want to change. Returns the full updated settings object. Returns `409` if the update would disable `levelTemps` while `temperatureFormat` is still `"level"`, or if it would change `features.rhythms` (use `/api/rhythms/enable` or `/api/rhythms/disable`; sending the value it already has is fine). Returns `400` if a pause would end in the past or more than 14 days ahead, or is turned on while that side is in away mode.

#### Request Body

```json
{
  "timeZone": "America/Los_Angeles",
  "temperatureFormat": "fahrenheit",
  "rebootDaily": true,
  "left": {
    "name": "Left",
    "awayMode": false
  },
  "primePodDaily": {
    "enabled": true,
    "time": "14:00"
  }
}
```

---

## `/api/schedules`

### GET

- Retrieves the current schedules for the system.

#### Response

```json
{
  "left": {
    "monday": {
      "temperatures": {
        "07:00": 72,
        "22:00": 68
      },
      "power": {
        "on": "20:00",
        "off": "08:00",
        "onTemperature": 82,
        "enabled": true
      },
      "alarm": {
        "time": "08:00",
        "vibrationIntensity": 100,
        "vibrationPattern": "rise",
        "duration": 10,
        "enabled": true,
        "alarmTemperature": 78
      },
      "alarms": [
        {
          "time": "06:30",
          "vibrationIntensity": 100,
          "vibrationPattern": "rise",
          "duration": 10,
          "enabled": true,
          "alarmTemperature": 78
        },
        {
          "time": "07:15",
          "vibrationIntensity": 100,
          "vibrationPattern": "rise",
          "duration": 10,
          "enabled": true,
          "alarmTemperature": 78
        }
      ]
    }
  }
}
```

### POST

- Updates the schedules for the system. Up to 10 alarms and 48 temperature changes per side/day; a day already stored above a limit can be saved at its current size but not grown.
- A scheduled power off waits for an alarm of the same side that is due at that minute to finish ringing, for at most nine minutes, so the alarm does not find the side already off. It does not wait for an alarm that starts the next night, and it is skipped if a scheduled power on for the same side is due at that minute or later.

#### Request Body

```json
{
  "left": {
    "monday": {
      "power": {
        "on": "19:00",
        "off": "07:00",
        "enabled": true
      }
    }
  }
}
```

#### Response

```json
{
  "left": {
    "monday": {
      "temperatures": {},
      "power": {
        "on": "19:00",
        "off": "07:00",
        "onTemperature": 82,
        "enabled": true
      },
      "alarm": {
        "time": "08:00",
        "vibrationIntensity": 100,
        "vibrationPattern": "rise",
        "duration": 10,
        "enabled": false,
        "alarmTemperature": 78
      },
      "alarms": []
    }
  }
}
```

`alarm` is retained as the legacy primary alarm field. Use `alarms` to store multiple alarms for the same side/day; when `alarms` is provided, Nightstand schedules every enabled item in the array and mirrors the first item into `alarm` for older clients.

---

## `/api/rhythms`

Rhythms are named sleep plans per side, a weekly plan that picks a rhythm for each weekday, and date changes that pick a different rhythm (or no sleep) for one date. They are stored in `rhythmsDB.json`, apart from the weekly schedule, and are off unless `features.rhythms` is on. Only `POST /api/rhythms/enable` creates that file, and none of these routes changes `schedulesDB.json`. While Rhythms are active, the Pod follows them instead of the weekly schedule.

### GET `/api/rhythms`

- Returns whether Rhythms are on and the stored data. `data` is the stored file whenever it can be read, even when Rhythms are not active, and `null` otherwise.
- `status.reason` is present when `active` is false: `flag-off`, `absent` (not set up yet), `invalid` (the file could not be read), `unsupported-version` (saved by a newer version) or `fingerprint-mismatch` (the weekly schedule changed since Rhythms were set up). Later versions may add reasons.

#### Response

```json
{
  "status": { "enabled": true, "active": true },
  "data": {
    "version": 1,
    "legacyFingerprint": "7751bac1543dfb451bc211034ed29808b5d8c870fffe4c5883df45b158265704",
    "left": {
      "rhythms": {
        "workdays": {
          "id": "workdays",
          "name": "Workdays",
          "night": {
            "temperatures": { "23:00": 78, "03:00": 74 },
            "power": { "on": "22:00", "off": "07:00", "onTemperature": 82, "enabled": true },
            "alarm": { "time": "06:30", "vibrationIntensity": 80, "vibrationPattern": "rise", "duration": 30, "enabled": true, "alarmTemperature": 82 },
            "alarms": [
              { "time": "06:30", "vibrationIntensity": 80, "vibrationPattern": "rise", "duration": 30, "enabled": true, "alarmTemperature": 82 }
            ]
          },
          "wake": "06:30",
          "temperatureMode": "manual",
          "smart": { "baseLevel": 0, "intensity": "standard", "warmStart": true, "warmUp": true, "upEarly": false }
        }
      },
      "week": {
        "sunday": "workdays", "monday": "workdays", "tuesday": "workdays", "wednesday": "workdays",
        "thursday": "workdays", "friday": null, "saturday": null
      },
      "changes": [{ "date": "2026-10-12", "rhythmId": null }]
    },
    "right": { "rhythms": {}, "week": { "sunday": null, "monday": null, "tuesday": null, "wednesday": null, "thursday": null, "friday": null, "saturday": null }, "changes": [] }
  }
}
```

### POST `/api/rhythms`

- Saves one or both sides. A side that is sent replaces the stored side; a side that is left out is kept. The body accepts only `left` and `right`, and unknown keys anywhere inside a side are refused.
- Many date changes can be saved in one request. Changes more than 7 days old are dropped before the side is checked.
- A side can have up to 12 rhythms. Each rhythm is stored under its own `id`. The weekly plan and the date changes name existing rhythms or `null`. A date appears at most once, is a real date and is at most 60 days ahead in the Pod's time zone. A rhythm can have up to 48 temperature changes, or as many as it already has when more are stored.
- Two sleeps on the same side may not overlap, from now to 69 days ahead. Date changes reach 60 days ahead, so the last days of that span hold the weekly plan alone and a clash between two weekly nights cannot hide behind changes. A sleep that has already ended is not checked, so an overlap never involves a sleep that is over.
- Returns the same body as `GET /api/rhythms`.

#### Request Body

```json
{
  "left": {
    "rhythms": { "workdays": { "...": "a full rhythm, as in the GET response" } },
    "week": { "sunday": "workdays", "monday": "workdays", "tuesday": "workdays", "wednesday": "workdays", "thursday": "workdays", "friday": null, "saturday": null },
    "changes": [
      { "date": "2026-10-12", "rhythmId": null },
      { "date": "2026-10-16", "rhythmId": "workdays" }
    ]
  }
}
```

#### Errors

- `400 { "error": "Invalid request data", "details": [...] }`: the body does not match the schema.
- `400 { "error": "Invalid rhythms", "details": ["left: The Monday plan uses a rhythm that does not exist (nap)"] }`: a rule above is broken. Each detail starts with the side.
- `400 { "error": "Two sleeps would overlap", "overlaps": [{ "side": "left", "first": "2026-10-12", "second": "2026-10-13" }] }`: `first` and `second` are the start dates of the two sleeps.
- `409 { "error": "...", "state": "absent" }`: nothing is saved unless the stored file can be read. The text depends on `state`: `absent` is "Rhythms are not set up on this Pod", `unsupported` is "The saved rhythms are from a newer version" and `invalid` is "The saved rhythms could not be read". Switch on `state`, not the text.

### GET `/api/rhythms/sleeps`

- Returns the sleeps of one side that overlap a window: from Rhythms when they are active, otherwise from the weekly schedule. Alarms are left out when the side's alarms are turned off. While Rhythms are active, a side in away mode gets the present side's sleeps, with `side` naming the present side and no alarms, because alarms ring only on the present side; if both sides are away the answer is `[]`. The weekly schedule is returned as stored.
- Query: `side` (`left` or `right`), `from` and `to` (ISO 8601 date times with an offset, `to` after `from`, at most 16 days apart). Any other query key is refused with `400`.
- A sleep is named by the date it starts, in the Pod's time zone. `rhythmId` is `null` for sleeps from the weekly schedule. Events are sorted by time.
- For a Smart Schedule sleep, `start` is when the bed turns on (20 or 30 minutes before bedtime) and `smartCurve` gives `bedtime`, `coolStart`, `wake`, `daySleep` and the curve `points` (ISO times). The temperature events follow the curve.

#### Response

```json
[
  {
    "side": "left",
    "date": "2026-10-05",
    "rhythmId": "workdays",
    "start": "2026-10-06T05:00:00.000Z",
    "end": "2026-10-06T14:00:00.000Z",
    "wake": "2026-10-06T13:30:00.000Z",
    "night": { "...": "the rhythm's night" },
    "mode": "manual",
    "events": [
      { "kind": "power-on", "at": "2026-10-06T05:00:00.000Z", "temperatureF": 82 },
      { "kind": "temperature", "at": "2026-10-06T06:00:00.000Z", "temperatureF": 78 },
      { "kind": "temperature", "at": "2026-10-06T10:00:00.000Z", "temperatureF": 74 },
      { "kind": "alarm", "at": "2026-10-06T13:30:00.000Z", "alarm": { "...": "the alarm" }, "index": 0 },
      { "kind": "power-off", "at": "2026-10-06T14:00:00.000Z" }
    ]
  }
]
```

### GET `/api/rhythms/live`

- Returns the Smart Schedule night that is running for a side, read from memory. It writes nothing. The answer is `null` when Rhythms are not active, when the side has no Smart Schedule sleep being followed, or when both sides are in away mode. A side in away mode gets the present side's night, with `side` naming the present side.
- Query: `side` (`left` or `right`). A missing or unknown side, or any other query key, is refused with `400`.
- A manual temperature change on a Smart Schedule night holds the current level until the curve's next phase starts, at most 3 hours. A change made before the cool-down holds until the cool-down starts. `hold.until` is that end. Holds are kept in memory only, so a server restart drops them.

#### Response

```json
{
  "side": "left",
  "date": "2026-10-05",
  "phase": "cooldown",
  "waiting": false,
  "coolStart": "2026-10-06T05:20:00.000Z",
  "hold": { "until": "2026-10-06T06:10:00.000Z" },
  "baseSince": null,
  "nextChange": { "at": "2026-10-06T06:10:00.000Z", "level": -4, "phase": "hold" }
}
```

- `date` is the date the sleep starts, in the Pod's time zone.
- `phase` is the curve phase now: `prewarm`, `bedtime`, `cooldown`, `hold`, `warmup`, `wake` or `after`. It is `null` when none applies. Later versions may add phases.
- `waiting` is `true` while the cool-down waits for the person to get into bed.
- `coolStart` is when the cool-down starts or started. It is the bedtime before the night's start is decided, and when presence is stale or unknown. While `waiting` is `true` it is the latest the cool-down can start, 2 hours after the bedtime, and once the start is decided it is that start. It is rounded up to the minute, like the curve.
- `hold` is `null` when no manual change is holding the curve. A hold never runs past the power off.
- `baseSince` is when the curve was released to the base level, or `null` while it has not been. That happens when the person gets up early, if that setting is on, or leaves the bed between the wake time and 30 minutes after it.
- `nextChange` is the next change of the curve and the phase it starts, or `null` when none is left. `level` is a level on the same -10 to +10 scale as `baseLevel`, not a temperature. Points that a hold or a release to the base level suppresses are skipped, so `nextChange.at` is never before `hold.until`.
- Instants are ISO 8601 strings with an offset.

### POST `/api/rhythms/enable`

- Turns Rhythms on and rebuilds the Pod's jobs. The first time, it converts the weekly schedule into rhythms. Later times it keeps the saved rhythms and accepts the weekly schedule as it is now.
- The body must be empty or `{}`; any key is refused with `400`.
- `200 { "converted": true }`: `converted` is `true` when this call created the rhythms from the weekly schedule.
- `409 { "error": "..." }`: the saved rhythms are from a newer version or cannot be read, or a night in the weekly schedule cannot become a rhythm. Nothing changes.

### POST `/api/rhythms/disable`

- Turns Rhythms off, hands a sleep in progress back to the weekly schedule and rebuilds the Pod's jobs. The weekly schedule is restored as it was, with nothing copied back from Rhythms.
- Body: `{ "powerOffNow": true }` powers off a side that is running a Rhythms sleep instead of leaving it on. The key is optional and defaults to `false`; anything else is refused with `400`.
- Returns `200` with one entry per side, even when a side's hardware write failed:

```json
{
  "sides": [
    { "side": "left", "action": "kept-on-until", "until": "2026-10-06T14:00:00.000Z", "alarmOverrideSet": false },
    { "side": "right", "action": "legacy-takes-over", "until": "2026-10-06T14:30:00.000Z", "alarmOverrideSet": false, "deviceUpdateFailed": true }
  ]
}
```

- `action` is `none` (nothing was running), `legacy-takes-over` (the weekly schedule runs the rest of the night, until `until`), `kept-on-until` (the side stays on until `until`, and the firmware turns it off 5 minutes after that; its remaining alarms still ring, except on an away side, which has none, but they are held in memory only, so a server restart, including the daily reboot, drops them) or `powered-off`. `alarmOverrideSet` is `true` when the side's weekly alarms are switched off until `until` because that night's alarm already rang. `deviceUpdateFailed` is present and `true` when the Pod could not be told to change that side; the settings change was still made.

---

## `/api/execute`

### POST

- Executes a specific command on the device.
- Returns 400 for a `command` that is not a known command name. For `TEMP_LEVEL_LEFT` and `TEMP_LEVEL_RIGHT`, `arg` must be a plain whole number from -100 to 100; for `LEFT_TEMP_DURATION` and `RIGHT_TEMP_DURATION`, a plain whole number of seconds from 0 to 43200. Text such as `1e2`, `0x10`, `10.5` or a padded number is refused. Every other command takes `arg` as a string (or no `arg`), and a value of another type is refused with 400. Nothing is sent to the Pod for a 400. A 400 answers JSON `{ "message": "..." }`.

#### Request Body

```json
{
  "command": "SET_TEMP",
  "arg": "90"
}
```

#### Response

```json
{
  "success": true,
  "message": "Command 'SET_TEMP' executed successfully."
}
```

---

## `/api/alarm`

### POST

- Triggers the bed-vibration alarm immediately, independent of any schedule. Useful for testing alarm patterns/intensities from the UI.

#### Request Body

Same shape as the `alarm` field in `/api/schedules`, plus `side` and an optional `force` flag (validated by `AlarmJobSchema`). The Pod gets the `rise` pattern only when its hub is detected as a Pod 5; any other or unknown hub gets `double`, which rings on every Pod. The same rule applies to scheduled and one-time alarms.

```json
{
  "side": "left",
  "vibrationIntensity": 1,
  "vibrationPattern": "rise",
  "duration": 10,
  "force": false
}
```

#### Response

Returns the current schedules DB once the start command has been sent, not when the alarm ends. Returns 503 with `{ "error": { "message": "..." } }` if the alarm did not start, for example when the hardware connection is not back within 10 seconds. A non-forced alarm for a side that is off or in away mode does not start either.

---

## `/api/base-control` (Pod 4+)

Adjustable-base position control. Talks to the base over BLE; position state is mirrored in `memoryDB.baseStatus`.

### GET `/api/base-control`

Current base status.

```json
{
  "head": 30,
  "feet": 0,
  "isMoving": false,
  "lastUpdate": "2026-04-26T10:12:34Z",
  "isConfigured": true
}
```

### POST `/api/base-control`

Move base to an absolute position.

#### Request Body

| Field | Range | Required | Default |
|---|---|---|---|
| `head`     | 0-60 (degrees) | yes | n/a |
| `feet`     | 0-45 (degrees) | yes | n/a |
| `feedRate` | 30-100         | no  | 50  |

```json
{ "head": 25, "feet": 10, "feedRate": 50 }
```

#### Response

```json
{ "success": true, "position": { "head": 25, "feet": 10, "feedRate": 50 } }
```

### POST `/api/base-control/preset`

Move to a named preset defined in `8sleep/basePresets.ts`: `flat`, `sleep`, `relax`, or `read`.

```json
{ "preset": "relax" }
```

#### Response

```json
{ "success": true, "preset": "relax", "position": { "head": 30, "feet": 15, "feedRate": 50 } }
```

### POST `/api/base-control/stop`

Emergency-stop any in-progress base movement.

#### Response

```json
{ "success": true, "message": "Stop command sent" }
```

---

## `/api/jobs`

### POST

- Manually run one or more scheduled jobs on demand. Useful from the UI when, e.g., a sleep analysis didn't fire automatically. Returns `204 No Content`.

#### Request Body

Array of job keys:

```json
["analyzeSleepLeft", "analyzeSleepRight"]
```

Valid keys:
- `analyzeSleepLeft` / `analyzeSleepRight`, re-run sleep detection over the last 24 hours.
- `biometricsCalibrationLeft` / `biometricsCalibrationRight`, recalibrate cap-sensor presence thresholds over the last 2 hours. This manual path skips the occupied-bed check; run it only with an empty bed. Scheduled calibration uses a separate 6-hour lookback.
- `reboot`, reboots the pod immediately (`sudo /sbin/reboot`).
- `update`, starts `free-sleep-update.service` (the same path `/api/update` triggers).

`reboot` and `update` cannot be in the same request (400). While an update, rollback or switch is starting or running, `reboot` is refused; once a reboot has been issued, update, rollback, switch and further reboots are refused until the Pod restarts (or for 5 minutes if it does not).

Repeated keys in one request run once. If an analysis or calibration for the same side is already queued or running, the request returns 409 and nothing starts.

---

## `/api/metrics/sleep`

### GET

- Retrieves sleep records based on optional query parameters.
- Query parameters:
  - `side` (optional): Filter by the side of the bed (e.g., "left" or "right").
  - `startTime` (optional): Filter by the start time of sleep records, in ISO 8601 format.
  - `endTime` (optional): Filter by the end time of sleep records, in ISO 8601 format.

#### Response

```json
[
  {
    "id": 1,
    "side": "left",
    "entered_bed_at": "2025-02-15T22:00:00Z",
    "left_bed_at": "2025-02-16T06:00:00Z",
    "sleep_period_seconds": 28800,
    "times_exited_bed": 2
  },
  {
    "id": 2,
    "side": "right",
    "entered_bed_at": "2025-02-15T23:00:00Z",
    "left_bed_at": "2025-02-16T07:00:00Z",
    "sleep_period_seconds": 28800,
    "times_exited_bed": 1
  }
]
```

### PUT `/api/metrics/sleep/:id`

- Edits an existing sleep record (e.g., correct a bedtime that was off because of a presence-detection glitch). Body specifies the fields to overwrite; recalculates `sleep_period_seconds` and `times_exited_bed` when either bed-time field changes, unless the body sets them.
- `:id` must be a positive whole number (400 otherwise); 404 if no record has it. An `id` in the body is ignored.
- `side` must be `left` or `right`. Returns 400 if `left_bed_at` would be before `entered_bed_at`, for negative counts, reversed intervals, or times before 1970 or after 2038. Returns 409 if another record on the same side already starts at the new `entered_bed_at`.

### DELETE `/api/metrics/sleep/:id`

- Removes a sleep record. Useful for naps or false detections that should not count. Returns `204 No Content`, 400 for an id that is not a positive whole number, and 404 if no record has it.

---

## `/api/metrics/vitals`

### GET

- Retrieves vital records based on optional query parameters.
- Query parameters:
  - `side` (optional): Filter by the side of the bed (e.g., "left" or "right").
  - `startTime` (optional): Filter by the start time of vital records, in ISO 8601 format.
  - `endTime` (optional): Filter by the end time of vital records, in ISO 8601 format.

#### Response

```json
[
  {
    "id": 1,
    "side": "left",
    "timestamp": 1739656800,
    "heart_rate": 72,
    "breathing_rate": 16,
    "hrv": 42
  },
  {
    "id": 2,
    "side": "right",
    "timestamp": 1739660400,
    "heart_rate": 74,
    "breathing_rate": 15,
    "hrv": 45
  }
]
```

`timestamp` is epoch seconds, not an ISO 8601 string.

---

## `/api/metrics/vitals/summary`

### GET

- Retrieves summary statistics for vitals, including heart rate, breathing rate, and HRV (heart rate variability) within an optional time range.
- Query parameters:
  - `side` (optional): Filter by the side of the bed (e.g., "left" or "right").
  - `startTime` (optional): Filter by the start time of records, in ISO 8601 format.
  - `endTime` (optional): Filter by the end time of records, in ISO 8601 format.

#### Response

```json
{
  "avgHeartRate": 72,
  "minHeartRate": 65,
  "maxHeartRate": 80,
  "avgHRV": 52,
  "avgBreathingRate": 17
}
```

---

## `/api/metrics/movement`

### GET

- Per-bucket movement records derived from piezo data. Used to render the "movement" chart and as input to the sleep-stage classifier (high-movement epochs are flagged as `awake`).
- Query parameters: `side`, `startTime`, `endTime` (all optional, ISO 8601).

#### Response

```json
[
  { "id": 1, "side": "left", "timestamp": 1739657100, "total_movement": 312 },
  { "id": 2, "side": "left", "timestamp": 1739657400, "total_movement": 87 }
]
```

---

## `/api/metrics/sleep-stages`

### GET

- Per-epoch sleep-stage classification (awake / REM / light / deep) for a side over a time range. Heuristic classifier, no ML, built from the per-5-min `vitals` and `movement` rows. See [biometrics/BIOMETRICS.md](../biometrics/BIOMETRICS.md) for the algorithm.
- Required query parameters: `side`, `startTime`, `endTime`.

#### Response

```json
{
  "active": true,
  "epochs": [
    { "startUnix": 1739659200, "endUnix": 1739659500, "stage": "deep" },
    { "startUnix": 1739659500, "endUnix": 1739659800, "stage": "rem" }
  ],
  "totals":      { "awake": 0,    "rem": 5400, "light": 12000, "deep": 5100 },
  "percentages": { "awake": 0,    "rem": 24,   "light": 53,    "deep": 23 },
  "totalSeconds": 22500
}
```

`active` is false (with empty epochs/totals) when the sleep-score feature is disabled or biometrics is off; see `sleepScoreGuard.ts`.

---

## `/api/metrics/sleep-score`

### GET

- Returns an aggregate sleep score for a given sleep period, broken down into component contributions (duration, continuity, HRV, resting heart rate).
- Query parameters (all required): `side`, `startTime`, `endTime`.

#### Response

```json
{
  "active": true,
  "score": 82,
  "components": {
    "duration": { "score": 90, "weight": 0.4, "value": "7h 45m", "available": true },
    "continuity": { "score": 70, "weight": 0.3, "value": "2 exits", "available": true },
    "hrv": { "score": 85, "weight": 0.15, "value": "58 ms", "available": true },
    "restingHr": { "score": 85, "weight": 0.15, "value": "58 bpm", "available": true }
  }
}
```

A component's `weight` is redistributed proportionally across the other components when it is `available: false` (e.g. no HRV data for the window). `active` is false (with `score: null` and empty `components`) when the sleep-score feature is disabled or biometrics is off.

---

## `/api/metrics/server`

### GET

- In-process server metrics, intended for local debugging on the Pod (`curl localhost:3000/api/metrics/server`).

#### Response (shape; values are point-in-time)

```json
{
  "franken": {
    "commandLatencyMs": { "count": 8231, "p50": 18, "p95": 47, "avg": 20, "max": 210 },
    "timeouts": 0,
    "lastRoundtripAt": "2026-04-26T10:12:34.000Z",
    "queueDepth": 0
  },
  "ws": { "clientCount": 1 },
  "jobs": { "executions": { "ok": 28, "fail": 0 } },
  "uptimeSeconds": 7521,
  "memory": { "rssMb": 93, "heapUsedMb": 61 }
}
```

---

## Partial Updates for POST Requests

The POST endpoints (`/api/deviceStatus`, `/api/settings`, `/api/schedules`) support partial updates. You can send only the fields you wish to modify, and the system merges your input with the existing data.

### Example for `/api/deviceStatus`

#### Request Body

```json
{
  "left": {
    "targetTemperatureF": 88
  }
}
```

---

## `/api/services`

### GET

- Retrieves the health of the biometrics service and its background jobs.

#### Response

```json
{
  "biometrics": {
    "enabled": true,
    "jobs": {
      "installation": {
        "name": "Biometrics installation",
        "message": "",
        "status": "healthy",
        "description": "Whether or not biometrics was installed successfully",
        "timestamp": ""
      },
      "stream": {
        "name": "Biometrics stream",
        "message": "",
        "status": "healthy",
        "description": "Consumes the sensor data as a stream and calculates biometrics",
        "timestamp": "2025-11-01T17:14:50.003582+00:00"
      },
      "analyzeSleepLeft": {
        "name": "Analyze sleep - left",
        "message": "IntegrityError('UNIQUE constraint failed: movement.side, movement.timestamp')",
        "status": "failed",
        "description": "Analyzes sleep period",
        "timestamp": "2025-11-01T17:01:27.317609+00:00"
      },
      "analyzeSleepRight": {
        "name": "Analyze sleep - right",
        "message": "",
        "status": "healthy",
        "description": "Analyzes sleep period",
        "timestamp": "2025-10-26T08:04:10.404431+00:00"
      },
      "calibrateLeft": {
        "name": "Calibration job - Left",
        "message": "",
        "status": "healthy",
        "description": "Calculates presence thresholds for cap sensor data",
        "timestamp": "2025-10-30T21:01:18.225128+00:00"
      },
      "calibrateRight": {
        "name": "Calibration job - Right",
        "message": "",
        "status": "healthy",
        "description": "Calculates presence thresholds for cap sensor data",
        "timestamp": "2025-10-30T21:30:44.018862+00:00"
      },
      "pumpLeft": {
        "name": "Pump health - Left",
        "message": "",
        "status": "healthy",
        "description": "Whether the left pump is behaving normally",
        "timestamp": ""
      },
      "pumpRight": {
        "name": "Pump health - Right",
        "message": "",
        "status": "healthy",
        "description": "Whether the right pump is behaving normally",
        "timestamp": ""
      }
    },
    "sensorTemps": {
      "ambient": 2250,
      "heatsink": 3120,
      "left": 2410,
      "right": 2380,
      "lastUpdated": "2026-04-26T10:12:34Z"
    }
  }
}
```

`sensorTemps` here holds raw centi-degree-Celsius readings from the biometrics service; `/api/deviceStatus`'s `sensorTemps` is the converted, display-ready version.

### POST

- Enables or disables biometrics; send only the fields you want to change. Flipping `biometrics.enabled` to `false` also stops the biometrics stream service. Returns the full updated services object.

#### Request Body

```json
{ "biometrics": { "enabled": false } }
```

---

## `/api/metrics/presence`

### GET

Tracks presence on each side. State is stored in memory and resets on server
restart. Before the first observation, each side is `{ "present": false }`
with no timestamps; this means unobserved, not a confirmed empty bed.

#### Response after observations

```json
{
  "left": {
    "present": false,
    "stateChangedAt": "2025-12-18T00:05:00-08:00",
    "lastUpdatedAt": "2025-12-18T00:12:34-08:00",
    "lastPresenceAt": "2025-12-18T00:05:00-08:00"
  },
  "right": {
    "present": true,
    "stateChangedAt": "2025-12-17T22:00:00-08:00",
    "lastUpdatedAt": "2025-12-18T00:12:34-08:00",
    "lastPresenceAt": "2025-12-18T00:12:34-08:00"
  }
}
```

Timestamps are generated by the server:

- `stateChangedAt` records the first observation or latest entry/exit
  transition. Repeated heartbeats with the same state do not advance it.
- `lastUpdatedAt` advances on every accepted observation for that side and
  lets clients detect a stale stream.
- `lastPresenceAt` advances on entry, while present and on the exit
  transition. It remains absent until presence has been observed. The
  auto-off monitor uses it for time since presence.

### POST

The Python biometrics service posts transitions and periodic heartbeats.
Supply at least one side, with a required boolean `present` for each supplied
side. The server ignores caller-supplied observation timestamps.

```json
{ "left": { "present": true } }
```

Returns the current state for both sides. An omitted side retains its prior
state and timestamps. Missing sides or a side without boolean `present`
returns `400`. Presence has no WebSocket push; clients poll this endpoint.

---

## `/api/logs`

### GET `/api/logs`

- Lists log files available on the device. Reads from `/persistent/free-sleep-data/logs` and `/var/log`. Newest first.

```json
{ "logs": ["free-sleep-stream.log", "free-sleep.log", "sleep-analyzer.log"] }
```

### GET `/api/logs/:filename`

- Streams the named log file to the client as a `text/event-stream` (SSE), tailing as new lines arrive. Used by the in-app log viewer.

---

## `/api/serverStatus`

### GET

- Retrieves the status of the services that make up Nightstand. Each entry is `{ name, status, description, message, timestamp? }`, where `status` is one of `not_started`, `started`, `healthy`, `restarting`, `retrying`, `waiting_for_data`, or `failed`. The `analyzeSleep*`, `biometricsCalibration*`, `biometricsStream`, and `pumpHealth*` entries are only present while biometrics is enabled.
- `rhythmsSchedule` is present only while `features.rhythms` is on. Its `message` gives the number of jobs the last rebuild planned, that no time zone is set, which side could not be planned, or why the weekly schedule is running instead.
- `waterTank` is `healthy` while the tank sensor reads ok and `failed` once it has read low for about 30 seconds; its `timestamp` is when the current state began. It stays `not_started` until the first reading.

#### Response

```json
{
  "alarmSchedule": {
    "name": "Alarm schedule",
    "status": "healthy",
    "description": "",
    "message": ""
  },
  "database": {
    "name": "Database",
    "status": "healthy",
    "description": "Connection to SQLite DB",
    "message": ""
  },
  "express": {
    "name": "Express",
    "status": "healthy",
    "description": "The back-end server",
    "message": ""
  },
  "franken": {
    "name": "Franken sock",
    "status": "started",
    "description": "Socket service for controlling the hardware",
    "message": ""
  },
  "frankenMonitor": {
    "name": "Franken monitor",
    "status": "healthy",
    "description": "Handles gestures and monitoring the status",
    "message": ""
  },
  "jobs": {
    "name": "Job scheduler",
    "status": "healthy",
    "description": "Scheduling service for temperature changes, alarms, and maintenance",
    "message": ""
  },
  "logger": {
    "name": "Logger",
    "status": "healthy",
    "description": "Logging service",
    "message": ""
  },
  "powerSchedule": {
    "name": "Power schedule",
    "status": "healthy",
    "description": "Power on/off schedule",
    "message": ""
  },
  "primeSchedule": {
    "name": "Prime schedule",
    "status": "healthy",
    "description": "Daily prime job",
    "message": ""
  },
  "rebootSchedule": {
    "name": "Reboot schedule",
    "status": "healthy",
    "description": "Daily system reboots",
    "message": ""
  },
  "systemDate": {
    "name": "System date",
    "status": "healthy",
    "description": "Whether or not the system date is correct. Scheduling jobs depend on this.",
    "message": ""
  },
  "temperatureSchedule": {
    "name": "Temperature schedule",
    "status": "healthy",
    "description": "Temperature adjustment schedule",
    "message": ""
  },
  "waterTank": {
    "name": "Water tank",
    "status": "healthy",
    "description": "Water level in the tank",
    "message": "",
    "timestamp": "2026-09-20T18:04:11-07:00"
  },
  "biometricsInstallation": {
    "name": "Biometrics installation",
    "message": "",
    "status": "healthy",
    "description": "Whether or not biometrics was installed successfully",
    "timestamp": ""
  },
  "analyzeSleepLeft": {
    "name": "Analyze sleep - left",
    "message": "IntegrityError('UNIQUE constraint failed: movement.side, movement.timestamp')",
    "status": "failed",
    "description": "Analyzes sleep period",
    "timestamp": "2025-11-01T17:01:27.317609+00:00"
  },
  "analyzeSleepRight": {
    "name": "Analyze sleep - right",
    "message": "",
    "status": "healthy",
    "description": "Analyzes sleep period",
    "timestamp": "2025-10-26T08:04:10.404431+00:00"
  },
  "biometricsCalibrationLeft": {
    "name": "Calibration job - Left",
    "message": "",
    "status": "healthy",
    "description": "Calculates presence thresholds for cap sensor data",
    "timestamp": "2025-10-30T21:01:18.225128+00:00"
  },
  "biometricsCalibrationRight": {
    "name": "Calibration job - Right",
    "message": "",
    "status": "healthy",
    "description": "Calculates presence thresholds for cap sensor data",
    "timestamp": "2025-10-30T21:30:44.018862+00:00"
  },
  "biometricsStream": {
    "name": "Biometrics stream",
    "message": "",
    "status": "healthy",
    "description": "Consumes the sensor data as a stream and calculates biometrics",
    "timestamp": "2025-11-01T17:11:50.430377+00:00"
  },
  "pumpHealthLeft": {
    "name": "Pump health - Left",
    "message": "",
    "status": "healthy",
    "description": "Whether the left pump is behaving normally",
    "timestamp": ""
  },
  "pumpHealthRight": {
    "name": "Pump health - Right",
    "message": "",
    "status": "healthy",
    "description": "Whether the right pump is behaving normally",
    "timestamp": ""
  }
}
```

---

## `/api/storage`

### GET

- Disk usage for the data partition (`df`), plus a breakdown of what is using it (`du` on logs and the biometrics RAW archive, plus the SQLite DB file sizes).

#### Response

```json
{
  "mountPath": "/persistent/free-sleep-data",
  "totalBytes": 31138512896,
  "usedBytes": 8388608000,
  "availableBytes": 22749904896,
  "usedPercent": 26.9,
  "breakdown": {
    "logsBytes": 15728640,
    "biometricsArchiveBytes": 4194304000,
    "databaseBytes": 52428800
  }
}
```

---

## `/api/memory`

### GET

- System RAM usage, read from `/proc/meminfo` (falls back to Node's `os.totalmem()`/`os.freemem()` off-Linux, e.g. local dev on a Mac).

#### Response

```json
{
  "totalBytes": 2058354688,
  "usedBytes": 891289600,
  "availableBytes": 1167065088,
  "usedPercent": 43.3
}
```

---

## `/api/calibration`

### GET

- Presence-sensor (cap sensor) calibration state for each side.

#### Response

```json
{
  "left": {
    "state": "calibrated",
    "summary": "Learned from a 45 min empty-bed window.",
    "quality": 0.92,
    "calibratedAt": 1745704351,
    "lastRunStatus": "ok",
    "capFormat": "capSense2"
  },
  "right": {
    "state": "none",
    "summary": "Not calibrated yet. This happens automatically once the sensors record a stretch of empty bed.",
    "quality": null,
    "calibratedAt": null,
    "lastRunStatus": null,
    "capFormat": null
  }
}
```

`state` is `none` (no profile yet), `imported` (carried over from an earlier version by the migration tool, confidence unknown), or `calibrated` (produced by an actual empty-bed run on this install).

`capFormat` is the capacitance record format the Pod writes, such as `capSense2` or `capSense`, taken from the newest calibration run that recorded one; `null` means none has been recorded yet.

---

## `/api/changelog`

### GET

- Parses the repo's `CHANGELOG.md` into structured entries for the in-app changelog view. Parsed once and cached for the life of the process (the file only changes when the pod installs a new build).

#### Response

```json
{
  "entries": [
    { "version": "3.10.0", "date": "2026-07-20", "body": "### Added\n- ..." }
  ]
}
```

---

## `/api/update`

The update, rollback and switch POST routes below, like `update` and `reboot` in `/api/jobs`, return 409 with a `message` when they are refused because another update, rollback, switch or a reboot is already under way, and 500 with a `message` when the operation could not be started.

### POST `/api/update`

- Requests an asynchronous update via `free-sleep-update.service`. Returns
  `204 No Content` after requesting the background operation, not after a
  successful installation. The server may become temporarily unavailable;
  verify the running version when it returns. `/api/serverStatus` and the
  WebSocket `service-health` channel report liveness and health, not a defined
  update percentage or stage-event contract.

#### Request Body

Optional; omit both fields to select the newest release allowed by the saved
channel preference. Stable includes stable releases only; beta includes both
channels. Explicit version requests use the selected version instead.

```json
{ "targetVersion": "3.10.0", "allowDowngrade": false }
```

`targetVersion` must match `\d+.\d+.\d+`. `allowDowngrade` permits installing a version older than the one currently running.

### GET `/api/update/rollback-info`

- Whether an instant rollback is available (a `free-sleep-prev` tree from the last update) and which version it would roll back to.

#### Response

```json
{ "available": true, "version": "3.9.0" }
```

### POST `/api/update/rollback`

- Requests an application rollback using the saved `free-sleep-prev` tree. Returns `204 No Content` after requesting the background operation. This restores application code, not an earlier database or Eight Sleep firmware. Check the running version after it returns.

### POST `/api/update/revert-to-stock`

- Switches to upstream `throwaway31265/free-sleep`, retaining the data directory subject to upstream schema compatibility. This is not a firmware reset or a return to Eight Sleep software. The upstream app has no button to return to Nightstand; use the migration tool. Returns `204 No Content` after requesting the background operation, not after verified installation success.

### POST `/api/update/prepare-to-stop`

- Called by the update, rollback and switch scripts just before they stop the server, after every check that could still cancel the operation. The update script calls it only when it is installing an older version, and neither the update nor the rollback script calls it when the version it switches to has this route, since that version continues a Rhythms sleep itself. It answers only requests from the Pod itself (loopback); any other address gets `403`.
- Body: `{ "reason": "downgrade" }`, where `reason` is `downgrade`, `rollback` or `revert`. Anything else is refused with `400`.
- Always answers `204 No Content` once the work is done, including when the work failed (the failure is logged). On a stock install running only the updater, it does nothing.
- On this fork it prepares the Pod for a version that may not know Rhythms or a schedule pause:
  - A side running a Rhythms sleep is handed to the weekly schedule. When the weekly schedule also has a night in progress, the Pod is told to stop at that night's end instead; otherwise the side stays on until the firmware off time it was last given for that sleep, and that sleep's remaining alarms do not ring once the server stops.
  - When that sleep's alarm already rang and the weekly night still has an alarm ahead, `scheduleOverrides.alarm` on that side is set to `{ "disabled": true, "timeOverride": "", "expiresAt": <the weekly night's end> }`.
  - A paused side whose weekly night (in progress, or starting within a day) has its last alarm still paused when due gets the same override, expiring at that night's end, because older versions ignore a pause.
  - A side that already has an unexpired alarm override is left alone. These overrides stay in `settingsDB.json` for the next version, which skips that side's weekly alarms until they expire.

---

## WebSocket, `/ws/events`

Real-time push channel. Replaces the React app's prior 5-second deviceStatus polling. Connect with a normal browser `WebSocket`, no auth, no library required.

```
ws://<POD_IP>:3000/ws/events
```

### Frame format

Every frame is a JSON envelope:

```json
{ "channel": "device-status", "payload": { }, "ts": "2026-04-26T10:12:34.000Z" }
```

On connect, the server also sends one `{ "channel": "hello", "payload": { "ts": "..." } }` frame as a greeting; clients can ignore it.

### Channels

| Channel | When it fires | Payload |
|---|---|---|
| `device-status`  | `FrankenMonitor` diffs the last DeviceStatus snapshot and emits only when something actually changed (temperature, isOn, water level, etc.) | Full `DeviceStatus` object, same shape as `GET /api/deviceStatus` |
| `service-health` | An entry in `/api/serverStatus` changes (Franken monitor health, job scheduler status, etc.) | Partial server-status patch, only the fields that changed |
| `job-event`      | A scheduled job starts / succeeds / fails (alarms, temperature changes, prime, analyze-sleep, calibration) | `{ jobName, status: "started" \| "ok" \| "fail", message? }` |

### Heartbeat

The server pings every 15 s and drops sockets that miss a pong. Clients should not need to do anything, the browser handles pong frames automatically.

### Polling fallback

The React app's `eventStream.ts` reconnects with exponential backoff up to 30 s. While disconnected, the existing React Query hooks fall back to their normal HTTP polling so the UI never goes fully stale.

### Server-side polling

`FrankenMonitor` polls the hardware socket every 2 s, regardless of whether any WebSocket client is connected: the same loop detects physical tap gestures (quad-tap to toggle the base, double/triple-tap for temperature), and gestures need to stay responsive even when nobody has the app open. An earlier version throttled to 10 s when idle; that was removed because it made gesture response take up to 10 s. (Pod 4+ only; the Pod 3 slow-poll branch was removed alongside the WebSocket work.)
