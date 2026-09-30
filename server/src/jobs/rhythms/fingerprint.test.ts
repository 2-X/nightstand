import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Schedules } from '../../db/schedulesSchema.js';
import { legacyFingerprint } from './fingerprint.js';
import { alarmAt, nightOf, schedulesOf, WORKDAY } from './rhythmsTestData.js';

const reversedKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, inner]) => [key, reversedKeys(inner)]));
};

describe('legacyFingerprint', () => {
  const base = schedulesOf({ monday: WORKDAY, friday: nightOf({ on: '23:30', off: '08:00', alarms: [alarmAt('07:45'), alarmAt('07:50')] }) });

  it('is a sha256 hex digest', () => {
    assert.match(legacyFingerprint(base), /^[a-f0-9]{64}$/);
  });

  it('does not depend on key order', () => {
    assert.equal(legacyFingerprint(reversedKeys(base) as Schedules), legacyFingerprint(base));
  });

  it('treats a lone enabled alarm the same as the alarms list the loader makes of it', () => {
    const single = structuredClone(base);
    single.left.monday = { ...WORKDAY, alarm: alarmAt('06:30'), alarms: [] };
    assert.equal(legacyFingerprint(single), legacyFingerprint(base));
  });

  it('ignores the order of alarms and the stored primary alarm', () => {
    const shuffled = structuredClone(base);
    shuffled.left.friday.alarms.reverse();
    shuffled.left.friday.alarm = alarmAt('05:00', { enabled: false });
    assert.equal(legacyFingerprint(shuffled), legacyFingerprint(base));
  });

  it('ignores unknown keys at every level', () => {
    const future = structuredClone(base) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    future.futureSide = { kept: {} };
    future.left.futureDay = { kept: true };
    future.left.monday.futureKey = 1;
    (future.left.monday.power as Record<string, unknown>).futurePower = 2;
    assert.equal(legacyFingerprint(future as unknown as Schedules), legacyFingerprint(base));
  });

  it('changes when power, a temperature or an alarm changes', () => {
    const seen = new Set([legacyFingerprint(base)]);
    const edits: Array<(s: Schedules) => void> = [
      s => { s.left.monday.power.on = '22:15'; },
      s => { s.left.monday.power.enabled = false; },
      s => { s.left.monday.temperatures['23:00'] = 77; },
      s => { s.right.sunday.temperatures['01:00'] = 70; },
      s => { s.left.friday.alarms[0].time = '07:40'; },
      s => { s.left.friday.alarms[1].enabled = false; },
    ];
    for (const edit of edits) {
      const copy = structuredClone(base);
      edit(copy);
      const print = legacyFingerprint(copy);
      assert.ok(!seen.has(print), 'each edit gives a new fingerprint');
      seen.add(print);
    }
  });

  it('matches before and after the real schedules loader normalizes the file', async (t) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'rhythms-fingerprint-'));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    mkdirSync(path.join(folder, 'lowdb'));
    const stored = reversedKeys(structuredClone(base)) as Schedules;
    stored.left.monday = { ...stored.left.monday, alarm: alarmAt('06:30'), alarms: [] };
    writeFileSync(path.join(folder, 'lowdb', 'schedulesDB.json'), JSON.stringify(stored));
    process.env.DATA_FOLDER = `${folder}/`;
    process.env.ENV = 'local';
    const { default: schedulesDB } = await import('../../db/schedules.js');
    assert.deepEqual(schedulesDB.data.left.monday.alarms, [alarmAt('06:30')]);
    assert.equal(legacyFingerprint(schedulesDB.data), legacyFingerprint(stored));
  });
});
