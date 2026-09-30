import type { AlarmJob } from '../db/schedulesSchema.js';

// Pod 3 firmware rejects 'rise' and does not vibrate, and Pod 4 firmware
// falls back to 'double'. Only a hub known to be a Pod 5 gets the chosen
// pattern; any other hub gets 'double', which rings on every Pod.
export const supportsRisePattern = (hubVersion: string | undefined): boolean => hubVersion === 'Pod 5';

export const alarmPatternFor = (
  hubVersion: string | undefined,
  chosen: AlarmJob['vibrationPattern'],
): AlarmJob['vibrationPattern'] => supportsRisePattern(hubVersion) ? chosen : 'double';
