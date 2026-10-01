import { dailyAlarmSchedules } from '../../db/scheduleAlarms.js';
const pickAlarm = (alarm) => ({
    time: alarm.time,
    enabled: alarm.enabled,
    vibrationIntensity: alarm.vibrationIntensity,
    vibrationPattern: alarm.vibrationPattern,
    duration: alarm.duration,
    alarmTemperature: alarm.alarmTemperature,
});
// The night as the scheduler sees it: known keys only, and the loader's rule
// that a lone enabled `alarm` means `alarms: [alarm]`.
export function normalizeNight(daily) {
    const alarms = dailyAlarmSchedules({ ...daily, alarms: daily.alarms ?? [] }).map(pickAlarm);
    return {
        temperatures: { ...daily.temperatures },
        alarm: pickAlarm(alarms[0] ?? daily.alarm),
        alarms,
        power: {
            on: daily.power.on,
            off: daily.power.off,
            onTemperature: daily.power.onTemperature,
            enabled: daily.power.enabled,
        },
    };
}
// JSON with object keys sorted at every level, so equal data gives equal text.
export function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const record = value;
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}
//# sourceMappingURL=night.js.map