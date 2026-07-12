import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dailyAlarmSchedules } from './scheduleAlarms.js';
const alarm = (overrides = {}) => ({
    time: '07:00',
    enabled: true,
    vibrationIntensity: 50,
    vibrationPattern: 'rise',
    duration: 60,
    alarmTemperature: 82,
    ...overrides,
});
const day = (overrides = {}) => ({
    temperatures: {},
    alarm: alarm(),
    alarms: [],
    power: { on: '21:00', off: '08:00', onTemperature: 82, enabled: true },
    ...overrides,
});
describe('dailyAlarmSchedules', () => {
    it('returns the alarms array when it has entries', () => {
        const alarms = [alarm({ time: '06:30' }), alarm({ time: '07:15' })];
        assert.deepEqual(dailyAlarmSchedules(day({ alarms })), alarms);
    });
    it('falls back to the enabled legacy alarm when alarms is empty', () => {
        const legacy = alarm({ time: '05:45' });
        assert.deepEqual(dailyAlarmSchedules(day({ alarm: legacy })), [legacy]);
    });
    it('returns no alarms when alarms is empty and the legacy alarm is disabled', () => {
        assert.deepEqual(dailyAlarmSchedules(day({ alarm: alarm({ enabled: false }) })), []);
    });
    it('keeps disabled alarms in the array so callers can filter', () => {
        const alarms = [alarm({ enabled: false }), alarm({ time: '08:00' })];
        assert.deepEqual(dailyAlarmSchedules(day({ alarms })), alarms);
    });
});
//# sourceMappingURL=scheduleAlarms.test.js.map