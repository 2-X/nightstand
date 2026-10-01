import { createHash } from 'node:crypto';
import { SCHEDULE_DAYS, SCHEDULE_SIDES } from '../../db/scheduleKeys.js';
import { canonicalJson, normalizeNight } from './night.js';
// Earliest first; alarms at the same minute keep their stored order.
const byTime = (alarms) => alarms.map((alarm, index) => ({ alarm, index }))
    .sort((a, b) => (a.alarm.time < b.alarm.time ? -1 : a.alarm.time > b.alarm.time ? 1 : a.index - b.index))
    .map(({ alarm }) => alarm);
// Hash of what the weekly schedule does: power, temperatures and alarms per
// side and day. Key order, alarm order, unknown keys and the loader's alarm
// normalization do not change it.
export function legacyFingerprint(schedules) {
    const shape = Object.fromEntries(SCHEDULE_SIDES.map(side => [side, Object.fromEntries(SCHEDULE_DAYS.map(day => {
            const { power, temperatures, alarms } = normalizeNight(schedules[side][day]);
            return [day, { power, temperatures, alarms: byTime(alarms) }];
        }))]));
    return createHash('sha256').update(canonicalJson(shape)).digest('hex');
}
//# sourceMappingURL=fingerprint.js.map