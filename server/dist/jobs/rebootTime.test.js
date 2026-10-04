import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import schedule from 'node-schedule';
import { nextReboot, rebootClock } from './rebootTime.js';
const settings = (over = {}) => ({
    timeZone: 'America/Los_Angeles', primePodDaily: { enabled: true, time: '14:30' }, rebootDaily: true, ...over,
});
describe('rebootClock', () => {
    it('is an hour before the prime, wrapping past midnight', () => {
        assert.deepEqual(rebootClock('14:30'), { hour: 13, minute: 30 });
        assert.deepEqual(rebootClock('16:00'), { hour: 15, minute: 0 });
        assert.deepEqual(rebootClock('00:30'), { hour: 23, minute: 30 });
    });
});
describe('nextReboot', () => {
    it('is the first restart after the given time', () => {
        // 07:30 PDT, then 13:30 PDT the same day.
        assert.equal(nextReboot(settings(), new Date('2026-09-29T14:30:00Z'))?.toISOString(), '2026-09-29T20:30:00.000Z');
        // At it, the next day's.
        assert.equal(nextReboot(settings(), new Date('2026-09-29T20:30:00Z'))?.toISOString(), '2026-09-30T20:30:00.000Z');
    });
    it('is null when the Pod does not restart daily', () => {
        assert.equal(nextReboot(settings({ rebootDaily: false }), new Date('2026-09-29T14:30:00Z')), null);
        assert.equal(nextReboot(settings({ primePodDaily: { enabled: false, time: '14:30' } }), new Date('2026-09-29T14:30:00Z')), null);
    });
    it('reads a time that happens twice on the fall back night as the first, as the resolver does', () => {
        // A 02:30 prime restarts at 01:30, which happens twice on 2026-11-01.
        const restart = nextReboot(settings({ primePodDaily: { enabled: true, time: '02:30' } }), new Date('2026-11-01T07:00:00Z'));
        assert.equal(restart?.toISOString(), '2026-11-01T08:30:00.000Z');
    });
    it('reads a time the spring forward skips as the hour after, never later than the restart job', () => {
        // A 03:30 prime restarts at 02:30, which 2026-03-08 skips.
        const after = new Date('2026-03-08T08:00:00Z');
        const restart = nextReboot(settings({ primePodDaily: { enabled: true, time: '03:30' } }), after);
        assert.equal(restart?.toISOString(), '2026-03-08T10:30:00.000Z');
        // node-schedule skips that day's restart, so the latest off only errs early.
        const rule = new schedule.RecurrenceRule();
        Object.assign(rule, { hour: 2, minute: 30, tz: 'America/Los_Angeles' });
        const job = rule.nextInvocationDate(after);
        assert.ok(restart && job && restart.getTime() <= job.getTime());
    });
});
//# sourceMappingURL=rebootTime.test.js.map