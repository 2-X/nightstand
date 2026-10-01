import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SMART, RhythmIdSchema, RhythmSchema, RhythmsDBSchema, RhythmsUpdateSchema, SideRhythmsSchema, SmartScheduleSchema, } from './rhythmsSchema.js';
import { responseSchema } from './responseSchema.js';
import { dbOf, rhythmOf, sideOf, WORKDAY } from '../jobs/rhythms/rhythmsTestData.js';
describe('rhythmsSchema', () => {
    const db = dbOf(sideOf([rhythmOf('workday', WORKDAY, { name: 'Workday' })], { monday: 'workday' }, [
        { date: '2026-10-12', rhythmId: null },
    ]));
    it('accepts a complete file and the default Smart Schedule settings', () => {
        assert.equal(RhythmsDBSchema.safeParse(db).success, true);
        assert.equal(SmartScheduleSchema.safeParse(DEFAULT_SMART).success, true);
    });
    it('limits ids to short lowercase slugs', () => {
        for (const id of ['a', 'workday', 'night-shift-2', '9'.repeat(32)])
            assert.equal(RhythmIdSchema.safeParse(id).success, true, id);
        for (const id of ['', '-a', 'Workday', 'a b', '9'.repeat(33)])
            assert.equal(RhythmIdSchema.safeParse(id).success, false, id);
    });
    it('keeps a wake time of its own, in HH:mm', () => {
        assert.equal(db.left.rhythms.workday.wake, '06:30');
        assert.equal(RhythmSchema.safeParse({ ...db.left.rhythms.workday, wake: '07:15' }).success, true);
        for (const wake of ['7:15', '24:00', '', undefined]) {
            assert.equal(RhythmSchema.safeParse({ ...db.left.rhythms.workday, wake }).success, false, String(wake));
        }
    });
    it('trims names and caps them at 24 characters', () => {
        assert.equal(RhythmSchema.parse({ ...db.left.rhythms.workday, name: '  Workday ' }).name, 'Workday');
        assert.equal(RhythmSchema.safeParse({ ...db.left.rhythms.workday, name: '   ' }).success, false);
        assert.equal(RhythmSchema.safeParse({ ...db.left.rhythms.workday, name: 'x'.repeat(25) }).success, false);
    });
    it('rejects unknown keys, other versions and more than 120 changes', () => {
        assert.equal(RhythmsDBSchema.safeParse({ ...db, extra: 1 }).success, false);
        assert.equal(RhythmsDBSchema.safeParse({ ...db, version: 2 }).success, false);
        assert.equal(RhythmsDBSchema.safeParse({ ...db, legacyFingerprint: 'abc' }).success, false);
        const changes = Array.from({ length: 121 }, () => ({ date: '2026-10-12', rhythmId: null }));
        assert.equal(SideRhythmsSchema.safeParse({ ...db.left, changes }).success, false);
    });
    it('rejects unknown keys in a rhythm\'s power settings but the stored reader strips them', () => {
        const withExtra = structuredClone(db);
        withExtra.left.rhythms.workday.night.power.futurePower = true;
        const strict = RhythmsDBSchema.safeParse(withExtra);
        assert.equal(strict.success, false);
        assert.deepEqual(strict.success ? [] : strict.error.issues.map(issue => [issue.code, issue.path.join('.')]), [['unrecognized_keys', 'left.rhythms.workday.night.power']]);
        assert.deepEqual(responseSchema(RhythmsDBSchema).parse(withExtra), db);
    });
    it('accepts updates for either side and nothing else', () => {
        assert.equal(RhythmsUpdateSchema.safeParse({ left: db.left }).success, true);
        assert.equal(RhythmsUpdateSchema.safeParse({}).success, true);
        assert.equal(RhythmsUpdateSchema.safeParse({ left: db.left, version: 1 }).success, false);
    });
});
//# sourceMappingURL=rhythmsSchema.test.js.map