import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canStayOn, latestOff } from './smartOff.js';
const SET_OFF = new Date('2026-09-30T14:30:00Z');
const plus = (minutes) => new Date(SET_OFF.getTime() + minutes * 60_000);
describe('latestOff', () => {
    it('is 3 hours after the set off when nothing comes sooner', () => {
        assert.deepEqual(latestOff({ setOff: SET_OFF }), plus(180));
        assert.deepEqual(latestOff({ setOff: SET_OFF, nextStart: null, restart: null }), plus(180));
    });
    it('stays 30 minutes clear of the next sleep and of the daily restart', () => {
        assert.deepEqual(latestOff({ setOff: SET_OFF, nextStart: plus(120) }), plus(90));
        assert.deepEqual(latestOff({ setOff: SET_OFF, restart: plus(60) }), plus(30));
        assert.deepEqual(latestOff({ setOff: SET_OFF, nextStart: plus(100), restart: plus(150) }), plus(70));
    });
    it('never comes before the set off, and leaves no room when a wall is 30 minutes away or less', () => {
        for (const minutes of [0, 20, 30]) {
            const latest = latestOff({ setOff: SET_OFF, nextStart: plus(minutes) });
            assert.deepEqual(latest, SET_OFF);
            assert.equal(canStayOn(SET_OFF, latest), false);
        }
        assert.equal(canStayOn(SET_OFF, latestOff({ setOff: SET_OFF, nextStart: plus(31) })), true);
    });
    it('counts 3 real hours across the fall back night', () => {
        // 01:30 PDT on 2026-11-01, the first of the two 01:30s.
        const setOff = new Date('2026-11-01T08:30:00Z');
        assert.equal(latestOff({ setOff }).toISOString(), '2026-11-01T11:30:00.000Z');
    });
});
//# sourceMappingURL=smartOff.test.js.map