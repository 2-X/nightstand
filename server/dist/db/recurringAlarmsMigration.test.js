import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateLegacyAlarms } from './recurringAlarmsMigration.js';
const legacyAlarm = (overrides = {}) => ({
    time: '09:00',
    enabled: true,
    vibrationIntensity: 100,
    vibrationPattern: 'rise',
    duration: 10,
    alarmTemperature: 82,
    ...overrides,
});
const day = (overrides = {}) => ({
    temperatures: {},
    alarm: legacyAlarm({ enabled: false }),
    alarms: [],
    power: { on: '21:00', off: '09:00', onTemperature: 82, enabled: true },
    ...overrides,
});
// Build a full Schedules with a per-side day-map builder.
const emptySide = () => ({
    sunday: day(),
    monday: day(),
    tuesday: day(),
    wednesday: day(),
    thursday: day(),
    friday: day(),
    saturday: day(),
});
const schedules = (leftMut = () => { }) => {
    const left = emptySide();
    leftMut(left);
    return { left, right: emptySide() };
};
describe('migrateLegacyAlarms', () => {
    it('preserves the real enabled Saturday 09:00 alarm as a Saturday recurring alarm', () => {
        const s = schedules((left) => {
            left.saturday = day({ alarms: [legacyAlarm({ time: '09:00', enabled: true })] });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 1);
        const a = out.left[0];
        assert.equal(a.time, '09:00');
        assert.equal(a.enabled, true);
        assert.deepEqual(a.recurrence, { kind: 'customDays', days: [6] });
        assert.equal(a.vibration.intensity, 100);
        assert.equal(a.vibration.pattern, 'rise');
        assert.equal(a.vibration.duration, 10);
    });
    it('collapses an identical alarm on all 7 days into a single daily alarm', () => {
        const s = schedules((left) => {
            for (const d of ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']) {
                left[d] = day({ alarms: [legacyAlarm({ time: '06:30', enabled: true })] });
            }
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 1);
        assert.deepEqual(out.left[0].recurrence, { kind: 'daily' });
        assert.equal(out.left[0].time, '06:30');
    });
    it('collapses Mon-Fri into weekdays', () => {
        const s = schedules((left) => {
            for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
                left[d] = day({ alarms: [legacyAlarm({ time: '06:00', enabled: true })] });
            }
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 1);
        assert.deepEqual(out.left[0].recurrence, { kind: 'weekdays' });
    });
    it('collapses Sat+Sun into weekends', () => {
        const s = schedules((left) => {
            left.saturday = day({ alarms: [legacyAlarm({ time: '08:00', enabled: true })] });
            left.sunday = day({ alarms: [legacyAlarm({ time: '08:00', enabled: true })] });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 1);
        assert.deepEqual(out.left[0].recurrence, { kind: 'weekends' });
    });
    it('keeps alarms with different times as separate recurring alarms', () => {
        const s = schedules((left) => {
            left.monday = day({ alarms: [legacyAlarm({ time: '06:00', enabled: true })] });
            left.tuesday = day({ alarms: [legacyAlarm({ time: '07:00', enabled: true })] });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 2);
        const times = out.left.map((a) => a.time).sort();
        assert.deepEqual(times, ['06:00', '07:00']);
    });
    it('does not merge alarms that share a time but differ in vibration', () => {
        const s = schedules((left) => {
            left.monday = day({ alarms: [legacyAlarm({ time: '06:00', enabled: true, vibrationIntensity: 100 })] });
            left.tuesday = day({ alarms: [legacyAlarm({ time: '06:00', enabled: true, vibrationIntensity: 40 })] });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 2);
    });
    it('ignores a disabled legacy alarm entirely (only enabled alarms migrate)', () => {
        const s = schedules((left) => {
            left.monday = day({ alarms: [legacyAlarm({ time: '06:00', enabled: true })] });
            left.tuesday = day({ alarms: [legacyAlarm({ time: '06:00', enabled: false })] });
        });
        const out = migrateLegacyAlarms(s);
        // Only the enabled Monday alarm survives; the disabled Tuesday one is
        // dropped. Both share a time, so the sole survivor is a single Monday
        // recurring alarm.
        assert.equal(out.left.length, 1);
        assert.equal(out.left[0].enabled, true);
        assert.deepEqual(out.left[0].recurrence, { kind: 'customDays', days: [1] });
    });
    it('falls back to the legacy single `alarm` object when alarms[] is empty', () => {
        const s = schedules((left) => {
            left.friday = day({ alarms: [], alarm: legacyAlarm({ time: '05:45', enabled: true }) });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 1);
        assert.equal(out.left[0].time, '05:45');
        assert.deepEqual(out.left[0].recurrence, { kind: 'customDays', days: [5] });
    });
    it('drops a legacy alarm with an invalid time instead of throwing', () => {
        // Only Monday carries an enabled alarm, and its time is invalid. Every
        // other day's disabled placeholder is ignored, so nothing migrates.
        const s = schedules((left) => {
            left.monday = day({ alarms: [{ ...legacyAlarm({ enabled: true }), time: '25:99' }] });
        });
        const out = migrateLegacyAlarms(s);
        assert.equal(out.left.length, 0);
    });
    it('is idempotent in id assignment (same input -> same ids)', () => {
        const s = schedules((left) => {
            left.saturday = day({ alarms: [legacyAlarm({ time: '09:00', enabled: true })] });
        });
        const a = migrateLegacyAlarms(s);
        const b = migrateLegacyAlarms(s);
        assert.deepEqual(a.left.map((x) => x.id), b.left.map((x) => x.id));
    });
    it('produces an empty list when every day only has a disabled placeholder alarm', () => {
        // The default day() holds a disabled legacy `alarm`; none migrate.
        const out = migrateLegacyAlarms(schedules());
        assert.deepEqual(out.left, []);
        assert.deepEqual(out.right, []);
    });
});
//# sourceMappingURL=recurringAlarmsMigration.test.js.map