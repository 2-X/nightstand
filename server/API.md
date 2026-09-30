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
      "alarm": { "disabled": false, "timeOverride": "", "expiresAt": "" }
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
    "nightstandTheme": true
  }
}
```

- `temperatureFormat` is `fahrenheit`, `celsius`, or `level` (the -10..+10 scale the official Pod app uses; all three map to the same underlying Fahrenheit value).
- `updateChannel` is `stable` or `beta` and controls which releases the in-app updater treats as available.
- `rawArchiveRetentionDays` (1 to 60, default 14) is how long the pod keeps raw sensor recordings. Changing it rewrites `raw-archive.conf` in the data folder, which `scripts/archive-raw.sh` reads.
- `oneOffAlarm` is a single alarm that fires once at `fireAt` (an ISO 8601 datetime with offset) then disables itself, independent of the recurring per-day schedule in `/api/schedules`.
- `taps` maps each gesture (`doubleTap`/`tripleTap`/`quadTap`) to a `temperature`, `alarm`, or `base_control` action.
- `features` are runtime feature flags read by the app.

### POST

- Updates system settings; send only the fields you want to change. Returns the full updated settings object. Returns `409` if the update would disable `levelTemps` while `temperatureFormat` is still `"level"`.

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

- Updates the schedules for the system. Up to 10 alarms per side/day.

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

## `/api/execute`

### POST

- Executes a specific command on the device.

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

Same shape as the `alarm` field in `/api/schedules`, plus `side` and an optional `force` flag (validated by `AlarmJobSchema`).

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

Returns the current schedules DB.

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

- Edits an existing sleep record (e.g., correct a bedtime that was off because of a presence-detection glitch). Body specifies the fields to overwrite; recalculates `sleep_period_seconds` and `times_exited_bed` when both bed-time fields are supplied.

### DELETE `/api/metrics/sleep/:id`

- Removes a sleep record. Useful for naps or false detections that should not count. Returns `204 No Content`.

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
    "lastRunStatus": "ok"
  },
  "right": {
    "state": "none",
    "summary": "Not calibrated yet. This happens automatically once the sensors record a stretch of empty bed.",
    "quality": null,
    "calibratedAt": null,
    "lastRunStatus": null
  }
}
```

`state` is `none` (no profile yet), `imported` (carried over from an earlier version by the migration tool, confidence unknown), or `calibrated` (produced by an actual empty-bed run on this install).

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
