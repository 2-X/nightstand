// Pure helpers for the execute route, split out so they're testable without
// pulling in the Franken/config module chain (deviceApi.js requires env vars
// that aren't set in the test environment).

import type { frankenCommands } from '../../8sleep/deviceApi.js';

// This route sends `arg` straight to hardware, bypassing the range checks
// the validated /api/deviceStatus path enforces (calculateLevelFromF's
// -100..100 level range, and its 12-hour max "on" duration in
// updateDeviceStatus.ts). Mirror those bounds here so the raw passthrough
// can't send hardware something the UI path would reject.
export const NUMERIC_ARG_BOUNDS: Partial<Record<keyof typeof frankenCommands, [number, number]>> = {
  TEMP_LEVEL_LEFT: [-100, 100],
  TEMP_LEVEL_RIGHT: [-100, 100],
  LEFT_TEMP_DURATION: [0, 43200],
  RIGHT_TEMP_DURATION: [0, 43200],
};

export const isArgWithinBounds = (command: string, arg: unknown): boolean => {
  const bounds = NUMERIC_ARG_BOUNDS[command as keyof typeof frankenCommands];
  if (!bounds) return true;
  const [min, max] = bounds;
  const numericArg = Number(arg);
  return Number.isFinite(numericArg) && numericArg >= min && numericArg <= max;
};
