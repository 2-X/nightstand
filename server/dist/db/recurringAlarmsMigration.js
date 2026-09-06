// Migration shim: fold the legacy per-day-of-week alarms
// (schedulesDB[side][day].alarms / .alarm) into the Phase 2 side-level
// recurring-alarm list.
//
// Behaviour must be preserved exactly. In particular there is a real enabled
// Saturday 09:00 alarm on the production pod that has to come out the other
// side as a single enabled recurring alarm firing on Saturdays.
//
// Grouping: alarms that are identical in every user-facing field (time +
// vibration intensity/pattern/duration + enabled) but sit on different days of
// the week collapse into ONE recurring alarm whose recurrence is derived from
// the set of days they appeared on:
//   - all 7 days        -> { kind: 'daily' }
//   - exactly Mon-Fri   -> { kind: 'weekdays' }
//   - exactly Sat+Sun   -> { kind: 'weekends' }
//   - anything else      -> { kind: 'customDays', days: [...] }
// Only ENABLED legacy alarms migrate. That mirrors exactly what the old
// scheduler armed (it filtered on enabled), and avoids importing the disabled
// per-day placeholder alarms that seed every untouched day of a fresh install
// as junk entries. The real production Saturday 09:00 alarm is enabled, so it
// survives; a day the user never configured contributes nothing.
const DAY_ORDER = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function legacyAlarmsForDay(day) {
    if (!day || typeof day !== 'object')
        return [];
    const d = day;
    if (Array.isArray(d.alarms) && d.alarms.length > 0)
        return d.alarms;
    if (d.alarm && typeof d.alarm === 'object')
        return [d.alarm];
    return [];
}
function isValidPattern(p) {
    return p === 'double' || p === 'rise';
}
// Only migrate ENABLED alarms with a syntactically valid time; a
// timeless/garbage legacy entry could never have armed a job (the old scheduler
// skipped it) and a disabled entry was never armed, so dropping both preserves
// behaviour.
function normalize(alarm) {
    if (alarm.enabled !== true)
        return null;
    if (typeof alarm.time !== 'string' || !TIME_RE.test(alarm.time))
        return null;
    const intensityRaw = alarm.vibrationIntensity;
    const durationRaw = alarm.duration;
    const intensity = typeof intensityRaw === 'number' && Number.isFinite(intensityRaw)
        ? Math.min(100, Math.max(1, Math.round(intensityRaw)))
        : 100;
    const duration = typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? Math.min(300, Math.max(0, Math.round(durationRaw)))
        : 10;
    const pattern = isValidPattern(alarm.vibrationPattern) ? alarm.vibrationPattern : 'rise';
    const enabled = alarm.enabled === true;
    return { time: alarm.time, intensity, pattern, duration, enabled };
}
// Stable key for grouping identical alarms across days. `enabled` is always
// true here (disabled alarms are filtered out in normalize), so it is not part
// of the key.
function groupKey(a) {
    return `${a.time}|${a.intensity}|${a.pattern}|${a.duration}`;
}
function recurrenceForDays(days) {
    const set = new Set(days);
    if (set.size === 7)
        return { kind: 'daily' };
    const isWeekdays = set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d));
    if (isWeekdays)
        return { kind: 'weekdays' };
    const isWeekends = set.size === 2 && set.has(0) && set.has(6);
    if (isWeekends)
        return { kind: 'weekends' };
    return { kind: 'customDays', days: [...set].sort((x, y) => x - y) };
}
function migrateSide(sideSchedule, side) {
    // Map groupKey -> { alarm fields, set of day indexes it appeared on }.
    const groups = new Map();
    DAY_ORDER.forEach((dayName, dayIndex) => {
        const day = sideSchedule?.[dayName];
        for (const legacy of legacyAlarmsForDay(day)) {
            const fields = normalize(legacy);
            if (!fields)
                continue;
            const key = groupKey(fields);
            const existing = groups.get(key);
            if (existing) {
                existing.days.add(dayIndex);
            }
            else {
                groups.set(key, { fields, days: new Set([dayIndex]) });
            }
        }
    });
    const result = [];
    let seq = 0;
    for (const { fields, days } of groups.values()) {
        result.push({
            // Deterministic id derived from side + ordinal so re-running the
            // migration on the same input is idempotent (won't spawn duplicate ids).
            id: `mig-${side}-${seq}`,
            time: fields.time,
            recurrence: recurrenceForDays([...days]),
            vibration: {
                intensity: fields.intensity,
                duration: fields.duration,
                pattern: fields.pattern,
            },
            enabled: fields.enabled,
        });
        seq += 1;
    }
    return result;
}
/**
 * Build the recurring-alarm DB shape from the existing schedulesDB data.
 * Pure and deterministic; the DB module calls this once when
 * recurringAlarmsDB.json has no data yet.
 */
export function migrateLegacyAlarms(schedules) {
    return {
        left: migrateSide(schedules?.left, 'left'),
        right: migrateSide(schedules?.right, 'right'),
    };
}
//# sourceMappingURL=recurringAlarmsMigration.js.map