# Server Documentation

## Overview
Express server intended to run on the 8 sleep pod.  

## Features
- DOES NOT DEPEND ON INTERNET, if your internet goes out, your device will still run
- API capabilities
  - Full control over the temperature
  - Priming the device
  - Scheduling on/off
  - Scheduling temperature changes
  - Alarm scheduling - (work in progress, NOT COMPLETE)

---

## Architecture
The server is composed of the following key components:

### 1. **Core Server (`server.ts`):**
- Sets up and starts an Express.js server.
- Initializes middleware and routes.
- Manages graceful shutdown processes for reliability.

### 2. **Routes:**
- **`/api/deviceStatus`:** Fetches and updates the status of the device.
- **`/api/settings`:** Manages device settings (e.g., timezone, away mode, priming schedules).
- **`/api/schedules`:** Handles scheduling for device operations.
- **`/api/execute`:** Sends commands directly to the device.

### 3. **Jobs Scheduler (`src/jobs/`):**
- Schedules periodic tasks like temperature adjustments, power on/off, and device priming using the `node-schedule` library.
- Monitors changes to the DB storage files in `src/db/`, clears all schedules and recreates them every time changes are made


### 4. **Database (`src/db/`):**
- The JSON files are created the first time the server runs, you do not need to create them
- Uses `lowdb` for simple JSON-based storage.
- Includes schemas for schedules, settings, and time zones, validated with `zod`.


### 5. **8 Sleep Integration (`8sleep`):**
- Contains utilities to communicate with the "Franken" device using Unix sockets.
  - This is based off of the EXISTING code on the pod in /home/dac/app/

---

## Key Features

### Device control
- The server connects to the device using a Unix socket @ `/deviceinfo/dac.sock`
- Commands are sent to the device for various operations, including temperature adjustments and status retrieval.

### Scheduling
- Jobs like temperature changes, power toggling, and device priming are scheduled based on user-defined schedules.
- Changes to schedules or settings automatically trigger updates to the jobs

### API Endpoints
The server exposes RESTful endpoints for interaction:

## API Endpoints


### `/api/deviceStatus`

**GET**:
- Description: Retrieves the current status of the device.
- Sample Response:

```json
{
  "left": {
    "currentTemperatureF": 83,
    "targetTemperatureF": 90,
    "secondsRemaining": 300,
    "isAlarmVibrating": true,
    "isOn": true
  },
  "right": {
    "currentTemperatureF": 83,
    "targetTemperatureF": 92,
    "secondsRemaining": 400,
    "isAlarmVibrating": false,
    "isOn": true
  },
  "waterLevel": "true",
  "isPriming": false,
  // I'm unsure what these 2 things below are for, but these come from the device itself
  "sensorLabel": "\"00000-0000-000-00000\"",
  // This is the light settings, encoded in CBOR format (see the ninesleep repo for more details)
  "settings": "<>"
}
```

**POST**:
- Updates the device, you don't have to specify everyth
- Sample Request Body:
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

---

### `/api/settings`

**GET**:
- Description: Retrieves the current settings of the system.
- Sample Response:
```json
{
  "timeZone": "America/New_York",
  "left": {
    "awayMode": false
  },
  "right": {
    "awayMode": true
  },
  "primePodDaily": {
    "enabled": true,
    "time": "14:00"
  }
}
```

**POST**:
- Description: Updates system settings.
- Sample Request Body:
```json
{
  "timeZone": "America/Los_Angeles",
  "left": {
    "awayMode": true
  },
  "primePodDaily": {
    "enabled": false
  }
}
```
- Sample Response:
```json
{
  "timeZone": "America/Los_Angeles",
  "left": {
    "awayMode": true
  },
  "right": {
    "awayMode": true
  },
  "primePodDaily": {
    "enabled": false,
    "time": "14:00"
  }
}
```

---

### `/api/schedules`

**GET**:
- Description: Retrieves the current schedules for the system.
- Sample Response:
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
        "vibrationIntensity": 1,
        "vibrationPattern": "rise",
        "duration": 10,
        "enabled": true,
        "alarmTemperature": 78
      }
    }
  }
}
```

**POST**:
- Description: Updates the schedules for the system.
- Sample Request Body:
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
- Sample Response:
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
        "vibrationIntensityStart": 1,
        "vibrationIntensityEnd": 1,
        "duration": 10,
        "enabled": false,
        "alarmTemperature": 78
      }
    }
  }
}
```

---

### `/api/execute`

**POST**:
- Description: Executes a specific command on the device.
- Sample Request Body:
```json
{
  "command": "SET_TEMP",
  "arg": "90"
}
```
- Sample Response:
```json
{
  "success": true,
  "message": "Command 'SET_TEMP' executed successfully."
}
```

## Partial Updates for POST Requests

For the POST endpoints (`/api/deviceStatus`, `/api/settings`, `/api/schedules`), you do not need to send a complete payload. These endpoints support partial updates, meaning you can send only the fields you wish to modify, and the system will merge your input with the existing data.

### Example for `/api/deviceStatus`:
**Request Body:**
```json
{
  "left": {
    "targetTemperatureF": 88
  }
}
```

---

## Installation

### Prerequisites
- Node.js (v16 or higher) - This is not optional, the 8 sleep pod has node v-16.14.2
- NPM or Yarn

### Setup
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Start the server:
   ```bash
   npm start
   ```

---

## File Structure
```
server/
├── src/
│   ├── 8sleep/             # Integration with the "Franken" device
│   ├── db/                 # JSON database and schemas
│   ├── jobs/               # Job scheduling utilities
│   ├── logger.ts           # Logging configuration
│   ├── routes/             # API routes
│   ├── setup/              # Middleware and routes setup
│   ├── server.ts           # Core server entry point
├── dist/                   # Compiled output (generated by TypeScript)
├── tsconfig.json           
├── package.json            
```

---

## Development

### Running in Development Mode
1. Use `ts-node` for live reloading:
   ```bash
   npm run dev
   ```

---



## License
This project is licensed under the MIT License. See the `LICENSE.md` file for details.

---

## Acknowledgments
- Huge thanks to [@bobobo1618](https://github.com/bobobo1618) & their research on how the device is controlled via dac.sock

