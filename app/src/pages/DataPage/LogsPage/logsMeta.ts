// Plain-English description for each known log file, matched by pattern
// since rotated files get a numeric suffix (free-sleep1.log, sleep-analyzer2.log, etc).
const LOG_DESCRIPTIONS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /^free-sleep-stream\d*\.log$/,
    description: 'The biometrics stream process: reads live sensor data from both sides continuously. Usually the busiest log on the pod.',
  },
  {
    pattern: /^free-sleep-update\d*\.log$/,
    description: 'Output from the in-app updater, written each time you run an update from Settings.',
  },
  {
    pattern: /^free-sleep\d*\.log$/,
    description: 'The main Node server log (JSON): HTTP requests, job scheduling, and the hardware (Franken) connection.',
  },
  {
    pattern: /^sleep-analyzer\d*\.log$/,
    description: 'The overnight sleep-analysis job: turns raw sensor data from the previous night into sleep stages and a sleep score.',
  },
  {
    pattern: /^calibrate-sensor\d*\.log$/,
    description: 'The presence-detection calibration job: learns what an empty bed looks like to the capacitance sensors.',
  },
];

export const getLogDescription = (filename: string): string => {
  const match = LOG_DESCRIPTIONS.find(({ pattern }) => pattern.test(filename));
  return match?.description ?? 'System log file.';
};

export type LogLevel = 'error' | 'warn' | 'debug' | 'info' | null;

// Every log format in this repo marks its level near the start of the line,
// either the Python fixed-width formatter ("| ERROR    |") or winston JSON
// ({"level":"error",...}). Detect either without needing to know which
// format a given line is in.
export const detectLogLevel = (line: string): LogLevel => {
  if (/"level":"error"|\|\s*ERROR\s*\|/.test(line)) return 'error';
  if (/"level":"warn"|\|\s*WARNING\s*\|/.test(line)) return 'warn';
  if (/"level":"debug"|\|\s*DEBUG\s*\|/.test(line)) return 'debug';
  if (/"level":"info"|\|\s*INFO\s*\|/.test(line)) return 'info';
  return null;
};
