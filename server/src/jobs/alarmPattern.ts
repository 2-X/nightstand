import type { AlarmJob } from '../db/schedulesSchema.js';

// The vibration firmware is on the cover. Mixed or unknown hardware uses double.
export const supportsRisePattern = (
  hubVersion: string | undefined,
  coverVersion: string | undefined,
): boolean => hubVersion === 'Pod 5' && coverVersion === 'Pod 5';

export const alarmPatternFor = (
  hubVersion: string | undefined,
  coverVersion: string | undefined,
  chosen: AlarmJob['vibrationPattern'],
): AlarmJob['vibrationPattern'] => supportsRisePattern(hubVersion, coverVersion) ? chosen : 'double';
