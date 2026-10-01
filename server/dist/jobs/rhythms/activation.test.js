import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RhythmsStatusSchema } from '../../db/rhythmsSchema.js';
import { activation } from './activation.js';
import { legacyFingerprint } from './fingerprint.js';
import { dbOf, rhythmOf, schedulesOf, sideOf, WORKDAY } from './rhythmsTestData.js';
const schedules = schedulesOf({ monday: WORKDAY });
const db = dbOf(sideOf([rhythmOf('workday', WORKDAY)], { monday: 'workday' }), sideOf(), legacyFingerprint(schedules));
const settings = (rhythms) => ({ features: { rhythms } });
const ok = { state: 'ok', db };
describe('activation', () => {
    it('is active only with the flag on, a readable file and a matching fingerprint', () => {
        assert.deepEqual(activation(settings(true), ok, schedules), { active: true, db });
    });
    it('checks the flag first', () => {
        assert.deepEqual(activation(settings(false), ok, schedules), { active: false, reason: 'flag-off' });
        assert.deepEqual(activation(settings(false), { state: 'absent' }, schedules), { active: false, reason: 'flag-off' });
        assert.deepEqual(activation({}, ok, schedules), { active: false, reason: 'flag-off' });
    });
    it('reports each file state', () => {
        assert.deepEqual(activation(settings(true), { state: 'absent' }, schedules), { active: false, reason: 'absent' });
        assert.deepEqual(activation(settings(true), { state: 'invalid', error: 'x' }, schedules), { active: false, reason: 'invalid' });
        assert.deepEqual(activation(settings(true), { state: 'unsupported', version: 2 }, schedules), { active: false, reason: 'unsupported-version' });
    });
    it('stays inactive when the weekly schedule changed since Rhythms was turned on', () => {
        const edited = structuredClone(schedules);
        edited.left.monday.power.on = '22:30';
        assert.deepEqual(activation(settings(true), ok, edited), { active: false, reason: 'fingerprint-mismatch' });
    });
    it('only reports reasons the status response schema accepts', () => {
        const loads = [ok, { state: 'absent' }, { state: 'invalid', error: 'x' }, { state: 'unsupported', version: 2 }];
        const edited = structuredClone(schedules);
        edited.left.monday.power.on = '22:30';
        for (const flag of [true, false]) {
            for (const load of loads) {
                for (const current of [schedules, edited]) {
                    const result = activation(settings(flag), load, current);
                    const status = result.active ? { enabled: flag, active: true } : { enabled: flag, active: false, reason: result.reason };
                    assert.equal(RhythmsStatusSchema.safeParse(status).success, true);
                }
            }
        }
    });
});
//# sourceMappingURL=activation.test.js.map