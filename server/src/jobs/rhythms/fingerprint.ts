import { createHash } from 'node:crypto';
import { Schedules } from '../../db/schedulesSchema.js';
import { SCHEDULE_DAYS, SCHEDULE_SIDES } from '../../db/scheduleKeys.js';
import { canonicalJson, normalizeNight } from './night.js';

// Hash of what the weekly schedule does: power, temperatures and alarms per
// side and day. Key order, alarm order, unknown keys and the loader's alarm
// normalization do not change it.
export function legacyFingerprint(schedules: Schedules): string {
  const shape = Object.fromEntries(SCHEDULE_SIDES.map(side => [side, Object.fromEntries(SCHEDULE_DAYS.map(day => {
    const { power, temperatures, alarms } = normalizeNight(schedules[side][day]);
    return [day, { power, temperatures, alarms: alarms.map(canonicalJson).sort() }];
  }))]));
  return createHash('sha256').update(canonicalJson(shape)).digest('hex');
}
