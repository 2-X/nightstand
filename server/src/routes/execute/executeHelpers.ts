// Pure helpers for the execute route, split out so they're testable without
// pulling in the Franken/config module chain (deviceApi.js requires env vars
// that aren't set in the test environment).

import type { frankenCommands } from '../../8sleep/deviceApi.js';

// This route sends `arg` straight to hardware, bypassing the range checks
// the validated /api/deviceStatus path enforces (calculateLevelFromF's
// -100..100 level range, and the 12-hour max "on" duration in
// DeviceStatusUpdateSchema). Mirror those bounds here so the raw passthrough
// can't send hardware something the UI path would reject.
export const NUMERIC_ARG_BOUNDS: Partial<Record<keyof typeof frankenCommands, [number, number]>> = {
  TEMP_LEVEL_LEFT: [-100, 100],
  TEMP_LEVEL_RIGHT: [-100, 100],
  LEFT_TEMP_DURATION: [0, 43200],
  RIGHT_TEMP_DURATION: [0, 43200],
};

// The argument to send for a command, or undefined when it is not
// acceptable. Bounded commands take a plain whole number, sent in canonical
// form so the firmware never sees "1e2", "0x10" or padded text.
export const normalizeExecuteArg = (command: string, arg: unknown): string | undefined => {
  const bounds = NUMERIC_ARG_BOUNDS[command as keyof typeof frankenCommands];
  if (!bounds) {
    if (arg === undefined || arg === null || arg === '') return 'empty';
    return typeof arg === 'string' ? arg : undefined;
  }
  const text = typeof arg === 'number' ? String(arg) : arg;
  if (typeof text !== 'string' || !/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  const [min, max] = bounds;
  return value >= min && value <= max ? String(value) : undefined;
};
