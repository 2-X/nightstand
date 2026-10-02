import type { LastNight } from './useLastNight.ts';

// Time asleep is an estimate, so it says "about"; time in bed is measured. The score is not shown on Bed.
export function lastNightText({ duration }: LastNight): string | undefined {
  if (!duration) return undefined;
  if (/ asleep$/.test(duration)) return `Last night: about ${duration}`;
  if (/ in bed$/.test(duration)) return `Last night: ${duration}`;
  return undefined;
}
