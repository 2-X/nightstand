import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { alarmAhead, decideAtSetOff, nextStep, stepStreak, upFor } from './offWhenUp.js';
const MINUTE = 60_000;
const T = Date.parse('2026-09-30T13:30:00Z');
const m = (minutes) => T + minutes * MINUTE;
const UNKNOWN = { known: false, presentSince: null, absentSince: null };
const present = (since) => ({ known: true, presentSince: since, absentSince: null });
const absent = (since) => ({ known: true, presentSince: null, absentSince: since });
describe('stepStreak', () => {
    it('follows presence, and keeps the start of an absence', () => {
        assert.deepEqual(stepStreak(null, UNKNOWN, m(0)), { kind: 'unknown' });
        assert.deepEqual(stepStreak(null, present(m(-30)), m(0)), { kind: 'present' });
        assert.deepEqual(stepStreak({ kind: 'present' }, absent(m(-2)), m(0)), { kind: 'absent', since: m(-2) });
        assert.deepEqual(stepStreak({ kind: 'absent', since: m(-2) }, absent(m(-2)), m(5)), { kind: 'absent', since: m(-2) });
        assert.deepEqual(stepStreak(null, absent(m(-20)), m(0)), { kind: 'absent', since: m(-20) });
    });
    it('counts an absence after a gap in reports from when they resumed', () => {
        const gap = { kind: 'unknown' };
        const resumed = stepStreak(gap, absent(m(-40)), m(0));
        assert.deepEqual(resumed, { kind: 'absent', since: m(0) });
        // The old change time stays older than the resume, so the count keeps running.
        assert.deepEqual(stepStreak(resumed, absent(m(-40)), m(3)), { kind: 'absent', since: m(0) });
    });
    it('restarts on any present report', () => {
        assert.deepEqual(stepStreak({ kind: 'absent', since: m(-8) }, present(m(0)), m(0)), { kind: 'present' });
    });
    it('restarts on a return to bed between two looks, seen only as a newer change time', () => {
        assert.deepEqual(stepStreak({ kind: 'absent', since: m(-8) }, absent(m(-1)), m(0)), { kind: 'absent', since: m(-1) });
    });
});
describe('alarmAhead', () => {
    it('holds while an alarm due by the set off has not had time to start ringing', () => {
        assert.equal(alarmAhead([m(30)], m(0), m(60)), true);
        assert.equal(alarmAhead([m(30)], m(31), m(60)), true);
        assert.equal(alarmAhead([m(30)], m(32), m(60)), false);
        assert.equal(alarmAhead([m(90)], m(0), m(60)), false);
        assert.equal(alarmAhead([], m(0), m(60)), false);
    });
});
describe('upFor', () => {
    it('needs 10 unbroken minutes, counted from the opening at the earliest', () => {
        const streak = { kind: 'absent', since: m(-20) };
        assert.equal(upFor(streak, m(9), m(0)), false);
        assert.equal(upFor(streak, m(10), m(0)), true);
        assert.equal(upFor({ kind: 'absent', since: m(5) }, m(14), m(0)), false);
        assert.equal(upFor({ kind: 'absent', since: m(5) }, m(15), m(0)), true);
        assert.equal(upFor({ kind: 'present' }, m(60), m(0)), false);
        assert.equal(upFor({ kind: 'unknown' }, m(60), m(0)), false);
        assert.equal(upFor(null, m(60), m(0)), false);
    });
});
describe('decideAtSetOff', () => {
    const setOff = new Date(m(0));
    const latest = new Date(m(180));
    it('stays on only with room, fresh presence and someone in bed', () => {
        assert.equal(decideAtSetOff(present(m(-300)), setOff, latest), 'extend');
        assert.equal(decideAtSetOff(absent(m(-5)), setOff, latest), 'set-time');
        assert.equal(decideAtSetOff(UNKNOWN, setOff, latest), 'stale');
        assert.equal(decideAtSetOff(present(m(-300)), setOff, setOff), 'no-room');
        assert.equal(decideAtSetOff(UNKNOWN, setOff, setOff), 'no-room');
    });
});
describe('nextStep', () => {
    it('arms 15 minutes ahead, again once 10 or fewer remain, never past the latest', () => {
        assert.equal(nextStep(null, m(0), m(180)), m(15));
        assert.equal(nextStep(m(15), m(4), m(180)), null);
        assert.equal(nextStep(m(15), m(5), m(180)), m(20));
        assert.equal(nextStep(m(170), m(166), m(180)), m(180));
        assert.equal(nextStep(m(180), m(171), m(180)), null);
    });
});
//# sourceMappingURL=offWhenUp.test.js.map