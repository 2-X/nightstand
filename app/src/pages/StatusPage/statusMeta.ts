import { ServerStatusKey, Status } from '@api/serverStatusSchema.ts';

export type StatusGroup = 'schedules' | 'biometrics' | 'core';

export type StatusItemMeta = {
  group: StatusGroup;
  // Plain-English replacement for the raw backend `description` field.
  blurb: string;
  // What each status value specifically means for *this* item - falls back
  // to a generic meaning (see genericMeaning below) when a value isn't listed.
  meaning?: Partial<Record<Status, string>>;
  // Shown next to the Run button on items the user can trigger manually.
  runHint?: string;
};

export const STATUS_META: Record<ServerStatusKey, StatusItemMeta> = {
  alarmSchedule: {
    group: 'schedules',
    blurb: 'Wakes you up with vibration and temperature changes at your alarm time.',
    meaning: { healthy: 'Your alarms are loaded and will fire on time.' },
  },
  powerSchedule: {
    group: 'schedules',
    blurb: 'Turns each side of the bed on and off automatically.',
    meaning: { healthy: 'Your on/off schedule is active.' },
  },
  primeSchedule: {
    group: 'schedules',
    blurb: 'Runs the daily prime cycle that clears air bubbles from the water lines.',
    meaning: { healthy: "Today's prime is scheduled." },
  },
  rebootSchedule: {
    group: 'schedules',
    blurb: 'Restarts the pod once a day to keep things running smoothly, if enabled in Settings.',
    meaning: { healthy: 'The nightly reboot is scheduled.' },
  },
  temperatureSchedule: {
    group: 'schedules',
    blurb: 'Applies your saved temperature schedule throughout the night.',
    meaning: { healthy: 'Your temperature schedule is active.' },
  },
  biometricsInstallation: {
    group: 'biometrics',
    blurb: 'Whether the biometrics add-on (heart rate, HRV, sleep stages) is installed on the pod.',
    meaning: { healthy: 'Installed and available.' },
  },
  biometricsStream: {
    group: 'biometrics',
    blurb: 'Reads live sensor data from both sides of the bed in real time.',
    meaning: { healthy: 'Actively streaming sensor data right now.' },
  },
  analyzeSleepLeft: {
    group: 'biometrics',
    blurb: "Turns last night's raw sensor data into sleep stages and a sleep score, left side.",
    meaning: {
      healthy: 'Finished analyzing the most recent sleep session.',
      waiting_for_data: 'No full night to analyze yet. Runs automatically after your first night.',
    },
    runHint: 'Analyzes the last 12 hours right now, instead of waiting for the overnight job.',
  },
  analyzeSleepRight: {
    group: 'biometrics',
    blurb: "Turns last night's raw sensor data into sleep stages and a sleep score, right side.",
    meaning: {
      healthy: 'Finished analyzing the most recent sleep session.',
      waiting_for_data: 'No full night to analyze yet. Runs automatically after your first night.',
    },
    runHint: 'Analyzes the last 12 hours right now, instead of waiting for the overnight job.',
  },
  biometricsCalibrationLeft: {
    group: 'biometrics',
    blurb: 'Learns what an empty bed looks like to the sensors, so presence detection stays accurate, left side.',
    meaning: {
      healthy: 'Calibration finished successfully.',
      waiting_for_data: 'Collecting data. Calibration runs automatically once the sensors record a stretch of empty bed.',
    },
    runHint: 'Recalibrates presence detection. Get off this side first: it assumes the side is empty.',
  },
  biometricsCalibrationRight: {
    group: 'biometrics',
    blurb: 'Learns what an empty bed looks like to the sensors, so presence detection stays accurate, right side.',
    meaning: {
      healthy: 'Calibration finished successfully.',
      waiting_for_data: 'Collecting data. Calibration runs automatically once the sensors record a stretch of empty bed.',
    },
    runHint: 'Recalibrates presence detection. Get off this side first: it assumes the side is empty.',
  },
  pumpHealthLeft: {
    group: 'biometrics',
    blurb: "Watches for a stalled water pump while the heater/cooler is running, left side. A stalled pump can make the sensor read a false runaway temperature.",
    meaning: {
      healthy: 'Circulating normally.',
      failed: 'Pump stall suspected: the displayed temperature on this side may not be accurate.',
    },
  },
  pumpHealthRight: {
    group: 'biometrics',
    blurb: "Watches for a stalled water pump while the heater/cooler is running, right side. A stalled pump can make the sensor read a false runaway temperature.",
    meaning: {
      healthy: 'Circulating normally.',
      failed: 'Pump stall suspected: the displayed temperature on this side may not be accurate.',
    },
  },
  express: {
    group: 'core',
    blurb: 'The web server this app and the pod controls run on.',
    meaning: { healthy: 'Responding normally.' },
  },
  franken: {
    group: 'core',
    blurb: "The low-level connection this app uses to talk to the pod's heating and cooling hardware.",
    meaning: { healthy: 'Connected to the hardware.' },
  },
  frankenMonitor: {
    group: 'core',
    blurb: 'Watches for physical taps on the pod and keeps the hardware connection alive.',
    meaning: { healthy: 'Watching for taps and monitoring the connection.' },
  },
  jobs: {
    group: 'core',
    blurb: 'The internal scheduler that runs all the timed jobs below (temperature, power, priming, reboots).',
    meaning: { healthy: 'Running, and jobs are firing on time.' },
  },
  logger: {
    group: 'core',
    blurb: 'Writes the activity logs you can view under Logs.',
    meaning: { healthy: 'Logging normally.' },
  },
  database: {
    group: 'core',
    blurb: 'Local storage for your settings, schedules, and sleep history.',
    meaning: { healthy: 'Reachable and passed its integrity check.' },
  },
  systemDate: {
    group: 'core',
    blurb: "Whether the pod's clock is correct. Scheduling depends on this.",
    meaning: { healthy: 'The clock is correct.' },
  },
};

// Fallback wording for status values a specific item didn't override above.
export const GENERIC_MEANING: Record<Status, string> = {
  healthy: 'Working normally.',
  not_started: "Hasn't run yet.",
  started: 'Running right now.',
  restarting: 'Recovering from an error, restarting automatically.',
  retrying: 'Hit a snag, retrying automatically.',
  failed: 'Needs attention.',
  waiting_for_data: 'Collecting data. This runs automatically once there is enough.',
};

export const GROUP_LABELS: Record<StatusGroup, string> = {
  schedules: 'Schedules',
  biometrics: 'Biometrics & sensors',
  core: 'Core services',
};
