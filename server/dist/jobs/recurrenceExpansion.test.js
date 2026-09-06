import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import moment from 'moment-timezone';
import { expandAlarmOccurrences } from './recurrenceExpansion.js';
const TZ = 'America/New_York';
// Helper: local wall-clock instant in TZ.
const at = (iso, tz = TZ) => moment.tz(iso, tz).valueOf();
const alarm = (overrides = {}) => ({
    id: 'a1',
    time: '07:00',
    recurrence: { kind: 'daily' },
    vibration: { intensity: 50, duration: 60, pattern: 'rise' },
    enabled: true,
    ...overrides,
});
// Every returned occurrence should land on the alarm's wall HH:mm in TZ.
function assertAllAtWallTime(occ, hhmm, tz = TZ) {
    for (const o of occ) {
        const local = moment.tz(o.epochMs, tz).format('HH:mm');
        assert.equal(local, hhmm, `occurrence ${new Date(o.epochMs).toISOString()} not at ${hhmm}`);
    }
}
describe('expandAlarmOccurrences', () => {
    it('returns nothing for a disabled alarm', () => {
        const from = at('2026-03-01T00:00:00');
        const occ = expandAlarmOccurrences(alarm({ enabled: false }), TZ, from, from + 7 * 864e5);
        assert.equal(occ.length, 0);
    });
    it('returns nothing when the window is empty or inverted', () => {
        const from = at('2026-03-01T00:00:00');
        assert.equal(expandAlarmOccurrences(alarm(), TZ, from, from).length, 0);
        assert.equal(expandAlarmOccurrences(alarm(), TZ, from, from - 1000).length, 0);
    });
    it('daily: one 07:00 occurrence per day, strictly after `from`', () => {
        // from is Sunday 2026-03-01 08:00, so the same-day 07:00 is already past.
        const from = at('2026-03-01T08:00:00');
        const to = at('2026-03-04T08:00:00'); // Wed 08:00
        const occ = expandAlarmOccurrences(alarm(), TZ, from, to);
        // Mar 2 07:00, Mar 3 07:00, Mar 4 07:00 (all after from, <= to)
        assert.equal(occ.length, 3);
        assertAllAtWallTime(occ, '07:00');
        assert.ok(occ[0].epochMs < occ[1].epochMs && occ[1].epochMs < occ[2].epochMs);
    });
    it('daily: same-day occurrence still ahead of `from` is included', () => {
        const from = at('2026-03-01T06:00:00'); // before 07:00
        const to = at('2026-03-01T23:00:00');
        const occ = expandAlarmOccurrences(alarm(), TZ, from, to);
        assert.equal(occ.length, 1);
        assert.equal(moment.tz(occ[0].epochMs, TZ).format('HH:mm'), '07:00');
    });
    it('weekdays: only Mon-Fri', () => {
        // Window covers a full week starting Sunday 2026-03-01.
        const from = at('2026-03-01T00:00:00'); // Sunday
        const to = at('2026-03-08T00:00:00'); // next Sunday 00:00
        const occ = expandAlarmOccurrences(alarm({ recurrence: { kind: 'weekdays' } }), TZ, from, to);
        // Mon Mar2 .. Fri Mar6 = 5 occurrences.
        assert.equal(occ.length, 5);
        for (const o of occ) {
            const dow = moment.tz(o.epochMs, TZ).day();
            assert.ok(dow >= 1 && dow <= 5, `unexpected weekday ${dow}`);
        }
    });
    it('weekends: only Sat + Sun', () => {
        const from = at('2026-03-01T00:00:00'); // Sunday
        const to = at('2026-03-08T00:00:00');
        const occ = expandAlarmOccurrences(alarm({ recurrence: { kind: 'weekends' } }), TZ, from, to);
        // Sun Mar1 07:00 (after from 00:00), Sat Mar7 07:00 = 2.
        assert.equal(occ.length, 2);
        for (const o of occ) {
            const dow = moment.tz(o.epochMs, TZ).day();
            assert.ok(dow === 0 || dow === 6, `unexpected weekday ${dow}`);
        }
    });
    it('customDays: only the listed weekday indexes', () => {
        const from = at('2026-03-01T00:00:00'); // Sunday
        const to = at('2026-03-08T00:00:00');
        // Monday(1) + Thursday(4)
        const occ = expandAlarmOccurrences(alarm({ recurrence: { kind: 'customDays', days: [1, 4] } }), TZ, from, to);
        // Mon Mar2, Thu Mar5 = 2.
        assert.equal(occ.length, 2);
        const dows = occ.map((o) => moment.tz(o.epochMs, TZ).day());
        assert.deepEqual(dows.sort(), [1, 4]);
    });
    it('everyNDays: fires on the anchor and every n-th day after, not before', () => {
        // anchor Mar 1, n=3 -> Mar1, Mar4, Mar7, Mar10...
        const from = at('2026-02-27T00:00:00'); // two days before anchor
        const to = at('2026-03-11T00:00:00');
        const occ = expandAlarmOccurrences(alarm({ recurrence: { kind: 'everyNDays', n: 3, anchorDate: '2026-03-01' } }), TZ, from, to);
        const days = occ.map((o) => moment.tz(o.epochMs, TZ).format('YYYY-MM-DD'));
        assert.deepEqual(days, ['2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10']);
        assertAllAtWallTime(occ, '07:00');
    });
    it('everyNDays with n=1 is equivalent to daily from the anchor', () => {
        const from = at('2026-03-01T00:00:00');
        const to = at('2026-03-05T00:00:00');
        const occ = expandAlarmOccurrences(alarm({ recurrence: { kind: 'everyNDays', n: 1, anchorDate: '2026-03-01' } }), TZ, from, to);
        assert.equal(occ.length, 4); // Mar2,3,4,5 (Mar1 07:00 == from, excluded by >from)
    });
    it('midnight wrap: a 00:30 alarm belongs to the calendar day it names', () => {
        const from = at('2026-03-01T00:00:00'); // Sunday 00:00
        const to = at('2026-03-03T12:00:00');
        const occ = expandAlarmOccurrences(alarm({ time: '00:30' }), TZ, from, to);
        // Mar1 00:30, Mar2 00:30, Mar3 00:30 = 3, each at 00:30.
        assert.equal(occ.length, 3);
        assertAllAtWallTime(occ, '00:30');
    });
    it('DST spring-forward: 07:00 stays 07:00 across the March gap', () => {
        // US DST 2026 spring forward: Sunday March 8 2026 02:00 -> 03:00.
        const from = at('2026-03-06T12:00:00'); // Fri
        const to = at('2026-03-10T12:00:00'); // Tue
        const occ = expandAlarmOccurrences(alarm(), TZ, from, to);
        // Mar7 07:00, Mar8 07:00 (DST day), Mar9 07:00, Mar10 07:00 = 4.
        assert.equal(occ.length, 4);
        assertAllAtWallTime(occ, '07:00'); // never drifts to 06:00/08:00
        // The DST-day occurrence is only 23h after the prior day, not 24h.
        const mar8 = occ.find((o) => moment.tz(o.epochMs, TZ).format('YYYY-MM-DD') === '2026-03-08');
        const mar7 = occ.find((o) => moment.tz(o.epochMs, TZ).format('YYYY-MM-DD') === '2026-03-07');
        assert.ok(mar8 && mar7);
        assert.equal((mar8.epochMs - mar7.epochMs) / 3600000, 23);
    });
    it('DST fall-back: a 07:00 alarm has exactly one occurrence that day (25h earlier gap)', () => {
        // US DST 2026 fall back: Sunday Nov 1 2026 02:00 -> 01:00.
        const from = at('2026-10-30T12:00:00'); // Fri
        const to = at('2026-11-03T12:00:00'); // Tue
        const occ = expandAlarmOccurrences(alarm(), TZ, from, to);
        const nov1 = occ.filter((o) => moment.tz(o.epochMs, TZ).format('YYYY-MM-DD') === '2026-11-01');
        assert.equal(nov1.length, 1, 'exactly one 07:00 on the fall-back day');
        assertAllAtWallTime(occ, '07:00');
        const oct31 = occ.find((o) => moment.tz(o.epochMs, TZ).format('YYYY-MM-DD') === '2026-10-31');
        assert.ok(oct31);
        // Fall-back day is 25h long, so 07:00 is 25h after the prior 07:00.
        assert.equal((nov1[0].epochMs - oct31.epochMs) / 3600000, 25);
    });
});
//# sourceMappingURL=recurrenceExpansion.test.js.map