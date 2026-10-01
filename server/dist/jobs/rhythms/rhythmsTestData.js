import { DEFAULT_SMART } from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';
export const alarmAt = (time, over = {}) => ({
    time, enabled: true, vibrationIntensity: 80, vibrationPattern: 'rise', duration: 30, alarmTemperature: 82, ...over,
});
export const nightOf = (over) => {
    const alarms = over.alarms ?? [];
    return {
        temperatures: over.temperatures ?? {},
        alarm: alarms[0] ?? alarmAt('07:00', { enabled: false }),
        alarms,
        power: { on: over.on, off: over.off, onTemperature: over.onTemperature ?? 82, enabled: over.enabled ?? true },
    };
};
export const OFF_NIGHT = nightOf({ on: '21:00', off: '09:00', enabled: false });
export const rhythmOf = (id, night, over = {}) => ({
    id, name: id, night, wake: wakeFromNight(night), temperatureMode: 'manual', smart: { ...DEFAULT_SMART }, ...over,
});
export const sideOf = (rhythms = [], week = {}, changes = []) => ({
    rhythms: Object.fromEntries(rhythms.map(rhythm => [rhythm.id, rhythm])),
    week: { sunday: null, monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, ...week },
    changes,
});
export const dbOf = (left, right = sideOf(), legacyFingerprint = '0'.repeat(64)) => ({
    version: 1, legacyFingerprint, left, right,
});
const sideScheduleOf = (days) => Object.fromEntries(SCHEDULE_DAYS.map(day => [day, structuredClone(days[day] ?? OFF_NIGHT)]));
export const schedulesOf = (left = {}, right = {}) => ({ left: sideScheduleOf(left), right: sideScheduleOf(right) });
export const WORKDAY = nightOf({
    on: '22:00', off: '07:00', temperatures: { '23:00': 78, '03:00': 74 }, alarms: [alarmAt('06:30')],
});
//# sourceMappingURL=rhythmsTestData.js.map