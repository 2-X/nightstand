import { DEFAULT_SMART, RHYTHMS_FILE_VERSION } from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';
import { legacyFingerprint } from './fingerprint.js';
const TEST_ALARM = {
    time: '07:00', enabled: true, vibrationIntensity: 60, vibrationPattern: 'rise', duration: 20, alarmTemperature: 82,
};
export function testNight(on, off, options = {}) {
    const alarms = (options.alarms ?? []).map(time => ({
        ...TEST_ALARM, time, vibrationIntensity: options.alarmIntensity ?? TEST_ALARM.vibrationIntensity,
    }));
    return {
        power: { on, off, enabled: options.enabled ?? true, onTemperature: options.onTemperature ?? 80 },
        temperatures: { ...(options.temperatures ?? {}) },
        alarm: alarms[0] ?? { ...TEST_ALARM, time: off, enabled: false },
        alarms,
    };
}
export function everyNight(night, id = 'every-night') {
    return {
        rhythms: night ? {
            [id]: { id, name: 'Every night', night, wake: wakeFromNight(night), temperatureMode: 'manual', smart: { ...DEFAULT_SMART } },
        } : {},
        week: Object.fromEntries(SCHEDULE_DAYS.map(day => [day, night ? id : null])),
        changes: [],
    };
}
export function testRhythmsDB(schedules, left, right = everyNight(null)) {
    return { version: RHYTHMS_FILE_VERSION, legacyFingerprint: legacyFingerprint(schedules), left, right };
}
//# sourceMappingURL=testSupport.js.map