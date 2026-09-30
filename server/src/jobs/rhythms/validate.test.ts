import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convertLegacy } from './convert.js';
import { pruneChanges, sideIssues } from './validate.js';
import { nightOf, rhythmOf, schedulesOf, sideOf, WORKDAY } from './rhythmsTestData.js';

const TODAY = '2026-10-05';
// Distinct set points ten minutes apart, starting at midnight.
const setPoints = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, n) =>
  [`${String(Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, 76]));
const busyNight = (count: number) => nightOf({ on: '22:00', off: '07:00', temperatures: setPoints(count) });
const busySide = (count: number) => sideOf([rhythmOf('busy', busyNight(count))], { monday: 'busy' });

describe('pruneChanges', () => {
  it('drops changes more than 7 days old and keeps the rest in order', () => {
    const changes = [
      { date: '2026-09-27', rhythmId: null },
      { date: '2026-09-28', rhythmId: null },
      { date: '2026-10-05', rhythmId: null },
      { date: '2026-12-04', rhythmId: null },
    ];
    assert.deepEqual(pruneChanges(changes, TODAY).map(change => change.date), ['2026-09-28', '2026-10-05', '2026-12-04']);
  });
});

describe('sideIssues', () => {
  const valid = sideOf([rhythmOf('workday', WORKDAY)], { monday: 'workday' }, [{ date: '2026-12-04', rhythmId: 'workday' }]);

  it('accepts a consistent side', () => {
    assert.deepEqual(sideIssues(valid, TODAY), []);
  });

  it('rejects rhythms that are missing, misfiled or too many', () => {
    const missing = sideOf([], { monday: 'workday' }, [{ date: '2026-10-10', rhythmId: 'nap' }]);
    assert.deepEqual(sideIssues(missing, TODAY), [
      'The Monday plan uses a rhythm that does not exist (workday)',
      'The change on 2026-10-10 uses a rhythm that does not exist (nap)',
    ]);
    const misfiled = { ...valid, rhythms: { other: valid.rhythms.workday } };
    assert.ok(sideIssues(misfiled, TODAY).includes('Rhythm other is stored under a different id (workday)'));
    const many = sideOf(Array.from({ length: 13 }, (_, n) => rhythmOf(`r${n}`, nightOf({ on: '22:00', off: '06:00' }))));
    assert.deepEqual(sideIssues(many, TODAY), ['A side can have at most 12 rhythms']);
  });

  it('does not mistake an inherited property name for a rhythm', () => {
    const side = sideOf([], { monday: 'constructor' }, [{ date: '2026-10-10', rhythmId: 'constructor' }]);
    assert.deepEqual(sideIssues(side, TODAY), [
      'The Monday plan uses a rhythm that does not exist (constructor)',
      'The change on 2026-10-10 uses a rhythm that does not exist (constructor)',
    ]);
  });

  it('does not mistake toString for a rhythm', () => {
    const side = sideOf([], { friday: 'toString' }, [{ date: '2026-10-10', rhythmId: 'toString' }]);
    assert.deepEqual(sideIssues(side, TODAY), [
      'The Friday plan uses a rhythm that does not exist (toString)',
      'The change on 2026-10-10 uses a rhythm that does not exist (toString)',
    ]);
  });

  it('leaves the wake time to the resolver, even outside the night', () => {
    const side = sideOf([rhythmOf('workday', WORKDAY, { wake: '15:00' })], { monday: 'workday' });
    assert.deepEqual(sideIssues(side, TODAY), []);
  });

  it('names a repeated unreal date once', () => {
    const side = sideOf([], {}, [{ date: '2026-02-30', rhythmId: null }, { date: '2026-02-30', rhythmId: null }]);
    assert.deepEqual(sideIssues(side, TODAY), ['2026-02-30 is not a real date']);
  });

  it('rejects unreal, repeated and far future dates', () => {
    const side = sideOf([], {}, [
      { date: '2026-02-30', rhythmId: null },
      { date: '2026-12-05', rhythmId: null },
      { date: '2026-10-06', rhythmId: null },
      { date: '2026-10-06', rhythmId: null },
    ]);
    assert.deepEqual(sideIssues(side, TODAY), [
      '2026-02-30 is not a real date',
      '2026-12-05 is more than 60 days ahead',
      '2026-10-06 has more than one change',
    ]);
  });

  it('allows 48 temperature changes per night, or more when the stored rhythm already has them', () => {
    assert.deepEqual(sideIssues(busySide(48), TODAY), []);
    assert.deepEqual(sideIssues(busySide(49), TODAY), ['Rhythm busy can have at most 48 temperature changes']);
    assert.deepEqual(sideIssues(busySide(49), TODAY, busySide(30)), ['Rhythm busy can have at most 48 temperature changes']);
    assert.deepEqual(sideIssues(busySide(60), TODAY, busySide(60)), []);
    assert.deepEqual(sideIssues(busySide(55), TODAY, busySide(60)), []);
    assert.deepEqual(sideIssues(busySide(61), TODAY, busySide(60)), ['Rhythm busy can have at most 60 temperature changes']);
    const renamed = sideOf([rhythmOf('other', busyNight(60))], { monday: 'other' });
    assert.deepEqual(sideIssues(renamed, TODAY, busySide(60)), ['Rhythm other can have at most 48 temperature changes']);
  });

  it('keeps saving a converted weekly night that is above the limit', () => {
    const { left } = convertLegacy(schedulesOf({ monday: busyNight(60) }));
    assert.deepEqual(sideIssues(left, TODAY, left), []);
  });

  it('checks many date changes in one save like single ones', () => {
    const dates = Array.from({ length: 30 }, (_, n) => `2026-10-${String(n + 1).padStart(2, '0')}`);
    const many = sideOf([rhythmOf('workday', WORKDAY)], {}, dates.map(date => ({ date, rhythmId: 'workday' })));
    assert.deepEqual(sideIssues(many, TODAY), []);
    const past = { ...many, changes: [...many.changes, { date: '2026-12-05', rhythmId: null }] };
    assert.deepEqual(sideIssues(past, TODAY), ['2026-12-05 is more than 60 days ahead']);
    assert.deepEqual(pruneChanges(many.changes, TODAY).length, 30);
  });
});
