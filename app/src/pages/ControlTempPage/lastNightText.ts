import type { LastNight } from './useLastNight.ts';

// The score is not shown on Bed, only its duration line.
export function lastNightText({ duration }: LastNight): string | undefined {
  if (!duration) return undefined;
  if (/ in bed$/.test(duration)) return `Last night: ${duration}`;
  return undefined;
}
