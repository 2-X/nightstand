import type { LastNight } from './useLastNight.ts';

export function lastNightText({ duration }: LastNight): string {
  return `Last night: ${duration}`;
}
