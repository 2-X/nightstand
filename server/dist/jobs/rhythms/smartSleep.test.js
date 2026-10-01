import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import moment from 'moment-timezone';
import { applySmartCurve, smartWake } from './smartSleep.js';
const TZ = 'America/Los_Angeles';
const local = (text) => moment.tz(text, 'YYYY-MM-DD HH:mm', TZ).toDate();
const ALARM = {
    time: '06:30', enabled: true, alarmTemperature: 82, vibrationIntensity: 50, vibrationPattern: 'rise', duration: 60,
};
const SMART = { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false };
function sleep(overrides = {}) {
    const start = local('2026-09-29 22:45');
    const end = local('2026-09-30 07:30');
    return {
        side: 'left',
        date: '2026-09-29',
        rhythmId: 'workday',
        start,
        end,
        wake: local('2026-09-30 06:30'),
        night: { temperatures: { '01:00': 70 }, alarm: ALARM, alarms: [], power: { on: '22:45', off: '07:30', onTemperature: 80, enabled: true } },
        mode: 'smart',
        smart: SMART,
        events: [
            { kind: 'power-on', at: start, temperatureF: 80 },
            { kind: 'temperature', at: local('2026-09-30 01:00'), temperatureF: 70 },
            { kind: 'alarm', at: local('2026-09-30 06:30'), alarm: ALARM, index: 0 },
            { kind: 'power-off', at: end },
        ],
        ...overrides,
    };
}
const describeEvents = (events) => events.map(event => [
    moment(event.at).tz(TZ).format('HH:mm'),
    event.kind,
    'temperatureF' in event ? event.temperatureF : null,
]);
describe('applySmartCurve', () => {
    it('replaces the temperature rows with the clock curve and moves power-on to the pre-warm', () => {
        const result = applySmartCurve(sleep(), TZ);
        assert.equal(result.start.getTime(), local('2026-09-29 22:15').getTime());
        assert.equal(result.end.getTime(), local('2026-09-30 07:30').getTime());
        assert.deepEqual(describeEvents(result.events), [
            ['22:15', 'power-on', 88],
            ['22:45', 'temperature', 88],
            ['22:55', 'temperature', 88],
            ['23:10', 'temperature', 85],
            ['23:25', 'temperature', 83],
            ['23:40', 'temperature', 80],
            ['23:55', 'temperature', 77],
            ['05:45', 'temperature', 77],
            ['05:56', 'temperature', 80],
            ['06:07', 'temperature', 83],
            ['06:18', 'temperature', 85],
            ['06:30', 'temperature', 88],
            ['06:30', 'alarm', null],
            ['07:00', 'temperature', 83],
            ['07:30', 'power-off', null],
        ]);
        assert.deepEqual(result.smartCurve && {
            bedtime: result.smartCurve.bedtime.getTime(),
            coolStart: result.smartCurve.coolStart.getTime(),
            wake: result.smartCurve.wake.getTime(),
            daySleep: result.smartCurve.daySleep,
            points: result.smartCurve.points.length,
        }, {
            bedtime: local('2026-09-29 22:45').getTime(),
            coolStart: local('2026-09-29 22:45').getTime(),
            wake: local('2026-09-30 06:30').getTime(),
            daySleep: false,
            points: 13,
        });
    });
    it('shifts only the cool-down when given a later start', () => {
        const result = applySmartCurve(sleep(), TZ, local('2026-09-29 23:00'));
        const times = describeEvents(result.events).map(([time]) => time);
        assert.deepEqual(times.slice(0, 7), ['22:15', '22:45', '23:10', '23:25', '23:40', '23:55', '00:10']);
        assert.deepEqual(times.slice(7), ['05:45', '05:56', '06:07', '06:18', '06:30', '06:30', '07:00', '07:30']);
    });
    it('wakes at the rhythm wake time, with or without an alarm', () => {
        const noAlarm = sleep({ events: sleep().events.filter(event => event.kind !== 'alarm') });
        assert.equal(smartWake(noAlarm).getTime(), local('2026-09-30 06:30').getTime());
        const early = { kind: 'alarm', at: local('2026-09-30 05:50'), alarm: { ...ALARM, time: '05:50' }, index: 1 };
        const later = sleep({ wake: local('2026-09-30 07:00'), events: [...sleep().events, early] });
        assert.equal(smartWake(later).getTime(), local('2026-09-30 07:00').getTime());
    });
    it('keeps the wake time inside the sleep', () => {
        assert.equal(smartWake(sleep({ wake: local('2026-09-30 09:00') })).getTime(), local('2026-09-30 07:30').getTime());
    });
    it('leaves manual sleeps and already-curved sleeps alone', () => {
        const manual = sleep({ mode: 'manual' });
        assert.equal(applySmartCurve(manual, TZ), manual);
        const curved = applySmartCurve(sleep(), TZ);
        assert.equal(applySmartCurve(curved, TZ), curved);
    });
});
//# sourceMappingURL=smartSleep.test.js.map