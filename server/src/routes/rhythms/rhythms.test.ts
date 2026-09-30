import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import moment from 'moment-timezone';
import type { Rhythm, SideRhythms } from '../../db/rhythmsSchema.js';

// Isolated DATA_FOLDER, set before the dynamic imports (config.ts reads it at
// import time).
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-rhythms-route-'));
const lowdb = path.join(folder, 'lowdb');
mkdirSync(lowdb);
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const { alarmAt, nightOf, rhythmOf, schedulesOf, sideOf, WORKDAY } = await import('../../jobs/rhythms/rhythmsTestData.js');
const TZ = 'America/Los_Angeles';
writeFileSync(path.join(lowdb, 'settingsDB.json'), JSON.stringify({ timeZone: TZ, features: { rhythms: true } }));
writeFileSync(path.join(lowdb, 'schedulesDB.json'), JSON.stringify(schedulesOf({ monday: WORKDAY })));

const { default: router } = await import('./rhythms.js');
const { default: schedulesDB } = await import('../../db/schedules.js');
const { updateSettings } = await import('../../db/settings.js');
const { createRhythms, updateRhythms } = await import('../../db/rhythms.js');
const { convertLegacy } = await import('../../jobs/rhythms/convert.js');
const { legacyFingerprint } = await import('../../jobs/rhythms/fingerprint.js');

const rhythmsFile = path.join(lowdb, 'rhythmsDB.json');
const schedulesFile = path.join(lowdb, 'schedulesDB.json');
// Taken after the schedules loader has normalized the file on import.
const schedulesBytes = readFileSync(schedulesFile);
const day = (offset: number) => moment.tz(TZ).startOf('day').add(offset, 'days').format('YYYY-MM-DD');

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  rmSync(folder, { recursive: true, force: true });
});

const get = async (url: string) => {
  const res = await fetch(`${baseUrl}${url}`);
  return { status: res.status, body: await res.json() };
};
const post = async (body: unknown) => {
  const res = await fetch(`${baseUrl}/rhythms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const sleepsUrl = (from: string, to: string, side = 'left') =>
  `/rhythms/sleeps?side=${side}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
const MONDAY = sleepsUrl('2026-10-05T00:00:00-07:00', '2026-10-07T00:00:00-07:00');

describe('before Rhythms has been turned on', () => {
  it('GET /rhythms reports the missing file without creating it', async () => {
    const res = await get('/rhythms');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: { enabled: true, active: false, reason: 'absent' }, data: null });
    assert.equal(existsSync(rhythmsFile), false);
  });

  it('POST /rhythms refuses to create the file', async () => {
    const res = await post({ left: sideOf() });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'Rhythms are not set up on this Pod', state: 'absent' });
    assert.equal(existsSync(rhythmsFile), false);
  });

  it('GET /rhythms/sleeps resolves the weekly schedule', async () => {
    const res = await get(MONDAY);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].rhythmId, null);
    assert.equal(res.body[0].start, '2026-10-06T05:00:00.000Z');
    assert.equal(res.body[0].events[0].at, '2026-10-06T05:00:00.000Z');
  });
});

describe('with Rhythms turned on', () => {
  before(async () => {
    await schedulesDB.read();
    const converted = convertLegacy(schedulesDB.data);
    await createRhythms({ version: 1, legacyFingerprint: legacyFingerprint(schedulesDB.data), ...converted });
  });

  it('GET /rhythms returns the active data', async () => {
    const res = await get('/rhythms');
    assert.deepEqual(res.body.status, { enabled: true, active: true });
    assert.equal(res.body.data.left.week.monday, 'monday');
  });

  it('GET /rhythms/sleeps resolves the rhythms', async () => {
    const res = await get(MONDAY);
    assert.equal(res.body[0].rhythmId, 'monday');
    assert.deepEqual(res.body[0].events.map((event: { kind: string }) => event.kind),
      ['power-on', 'temperature', 'temperature', 'alarm', 'power-off']);
  });

  it('GET /rhythms/sleeps leaves out alarms when the side has them off', async () => {
    await updateSettings(draft => { draft.left.alarmsEnabled = false; });
    const res = await get(MONDAY);
    await updateSettings(draft => { draft.left.alarmsEnabled = true; });
    assert.equal(res.body[0].events.some((event: { kind: string }) => event.kind === 'alarm'), false);
  });

  it('GET /rhythms/sleeps accepts a 16 day window and nothing longer or malformed', async () => {
    assert.equal((await get(sleepsUrl('2026-10-01T00:00:00Z', '2026-10-17T00:00:00Z'))).status, 200);
    for (const url of [
      sleepsUrl('2026-10-01T00:00:00Z', '2026-10-17T00:01:00Z'),
      sleepsUrl('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z'),
      sleepsUrl('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'middle'),
      sleepsUrl('yesterday', '2026-10-02T00:00:00Z'),
      `${MONDAY}&extra=1`,
      '/rhythms/sleeps?side=left',
    ]) {
      assert.equal((await get(url)).status, 400, url);
    }
  });

  it('POST /rhythms rejects unknown keys', async () => {
    const { body } = await get('/rhythms');
    assert.equal((await post({ left: body.data.left, version: 1 })).status, 400);
    const left = structuredClone(body.data.left);
    left.rhythms.monday.extra = true;
    assert.equal((await post({ left })).status, 400);
  });

  it('POST /rhythms rejects a plan that uses a missing rhythm or a date too far ahead', async () => {
    const res = await post({ left: sideOf([], { monday: 'gone' }, [{ date: day(61), rhythmId: null }]) });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.details, [
      'left: The Monday plan uses a rhythm that does not exist (gone)',
      `left: ${day(61)} is more than 60 days ahead`,
    ]);
  });

  it('POST /rhythms with no side leaves the file alone', async () => {
    const stored = readFileSync(rhythmsFile, 'utf8');
    try {
      writeFileSync(rhythmsFile, stored.replace(/\n\s*/g, ''));
      const compact = readFileSync(rhythmsFile, 'utf8');
      const res = await post({});
      assert.equal(res.status, 200);
      assert.equal(readFileSync(rhythmsFile, 'utf8'), compact);
    } finally {
      writeFileSync(rhythmsFile, stored);
    }
  });

  it('POST /rhythms drops old changes before checking them', async () => {
    const { body } = await get('/rhythms');
    const stale = { date: day(-8), rhythmId: 'deleted' };
    const res = await post({ left: { ...body.data.left, changes: [stale, { date: day(1), rhythmId: null }] } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.left.changes, [{ date: day(1), rhythmId: null }]);
    assert.equal((await post({ left: body.data.left })).status, 200);
  });

  it('POST /rhythms refuses sleeps that overlap and names both dates', async () => {
    const before = readFileSync(rhythmsFile, 'utf8');
    const nightly = rhythmOf('nightly', nightOf({ on: '22:00', off: '07:00' }));
    const long = rhythmOf('long', nightOf({ on: '23:00', off: '23:00' }));
    const everyNight = Object.fromEntries(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      .map(weekday => [weekday, 'nightly']));
    const res = await post({ left: sideOf([nightly, long], everyNight, [{ date: day(1), rhythmId: 'long' }]) });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Two sleeps would overlap', overlaps: [{ side: 'left', first: day(1), second: day(2) }] });
    assert.equal(readFileSync(rhythmsFile, 'utf8'), before);
  });

  it('POST /rhythms refuses a weekly clash that date changes hide for the first 60 days', async () => {
    const before = readFileSync(rhythmsFile, 'utf8');
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekdayOn = (offset: number) => weekdays[moment.tz(day(offset), TZ).day()];
    // Two consecutive weekdays, cleared on every date a change can reach, so they only clash after day 60.
    const [first, second] = [weekdayOn(64), weekdayOn(65)];
    const long = rhythmOf('long', nightOf({ on: '22:00', off: '22:00' }));
    const early = rhythmOf('early', nightOf({ on: '21:00', off: '06:00' }));
    const hidden = Array.from({ length: 61 }, (_, n) => n)
      .filter(n => [first, second].includes(weekdayOn(n)))
      .map(n => ({ date: day(n), rhythmId: null }));
    const res = await post({ left: sideOf([long, early], { [first]: 'long', [second]: 'early' }, hidden) });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'Two sleeps would overlap');
    assert.ok(res.body.overlaps.length > 0);
    assert.ok(res.body.overlaps.every((pair: { first: string }) => pair.first >= day(61)), JSON.stringify(res.body.overlaps));
    assert.equal(readFileSync(rhythmsFile, 'utf8'), before);
  });

  it('POST /rhythms names no overlap with a sleep that has ended or a date a change cleared', async () => {
    // Wednesday 2026-10-07 20:00 in Los Angeles, after both of the week's clashing sleeps are over.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-08T03:00:00Z') });
    try {
      const late = rhythmOf('late', nightOf({ on: '22:00', off: '05:00' }));
      const dawn = rhythmOf('dawn', nightOf({ on: '04:00', off: '06:00' }));
      const cleared = [{ date: '2026-10-13', rhythmId: null }, { date: '2026-10-14', rhythmId: null }];
      const res = await post({ left: sideOf([late, dawn], { tuesday: 'late', wednesday: 'dawn' }, cleared) });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.deepEqual(res.body.overlaps[0], { side: 'left', first: '2026-10-20', second: '2026-10-21' });
      assert.ok(res.body.overlaps.every((pair: { first: string }) => pair.first >= '2026-10-20'), JSON.stringify(res.body.overlaps));
    } finally {
      mock.timers.reset();
    }
  });

  it('POST /rhythms saves many date changes in one write', async () => {
    const { body } = await get('/rhythms');
    const changes = Array.from({ length: 20 }, (_, n) => ({ date: day(n + 3), rhythmId: n % 2 ? null : 'monday' }));
    const res = await post({ left: { ...body.data.left, changes } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.left.changes, changes);
    assert.equal((await post({ left: body.data.left })).status, 200);
  });

  it('POST /rhythms caps temperature changes at 48 per night and keeps a larger stored count', async () => {
    const { body } = await get('/rhythms');
    const withSetPoints = (count: number) => {
      const left = structuredClone(body.data.left) as SideRhythms;
      left.rhythms.monday.night.temperatures = Object.fromEntries(Array.from({ length: count }, (_, n) =>
        [`${String(Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, 76]));
      return left;
    };
    const tooMany = await post({ left: withSetPoints(49) });
    assert.equal(tooMany.status, 400);
    assert.deepEqual(tooMany.body.details, ['left: Rhythm monday can have at most 48 temperature changes']);
    // Stored above the cap, as a night converted from an older weekly day can be.
    await updateRhythms(draft => { draft.left = withSetPoints(60); });
    assert.equal((await post({ left: withSetPoints(60) })).status, 200);
    const grown = await post({ left: withSetPoints(61) });
    assert.equal(grown.status, 400);
    assert.deepEqual(grown.body.details, ['left: Rhythm monday can have at most 60 temperature changes']);
    assert.equal((await post({ left: body.data.left })).status, 200);
  });

  it('POST /rhythms applies two saves sent at once without losing either', async () => {
    const { body } = await get('/rhythms');
    const left = { ...body.data.left, changes: [{ date: day(2), rhythmId: null }] };
    const right = { ...body.data.right, changes: [{ date: day(3), rhythmId: null }] };
    const results = await Promise.all([post({ left }), post({ right })]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    const stored = JSON.parse(readFileSync(rhythmsFile, 'utf8'));
    assert.deepEqual(stored.left.changes, left.changes);
    assert.deepEqual(stored.right.changes, right.changes);
    assert.equal((await post({ left: body.data.left, right: body.data.right })).status, 200);
  });

  it('POST /rhythms checks the set point cap against the file the earlier save left', async () => {
    const { body } = await get('/rhythms');
    const withSetPoints = (count: number) => {
      const left = structuredClone(body.data.left) as SideRhythms;
      left.rhythms.monday.night.temperatures = Object.fromEntries(Array.from({ length: count }, (_, n) =>
        [`${String(Math.floor(n / 6)).padStart(2, '0')}:${String((n % 6) * 10).padStart(2, '0')}`, 76]));
      return left;
    };
    await updateRhythms(draft => { draft.left = withSetPoints(60); });
    const [shrink, regrow] = await Promise.all([post({ left: body.data.left }), post({ left: withSetPoints(60) })]);
    assert.equal(shrink.status, 200);
    // The second save sees the small night the first left, so the larger count is no longer grandfathered.
    assert.equal(regrow.status, 400);
    assert.deepEqual(regrow.body.details, ['left: Rhythm monday can have at most 48 temperature changes']);
    const stored = JSON.parse(readFileSync(rhythmsFile, 'utf8'));
    assert.deepEqual(stored.left.rhythms.monday.night.temperatures, body.data.left.rhythms.monday.night.temperatures);
  });

  it('POST /rhythms saves one side, prunes old changes and keeps the other side', async () => {
    const { body } = await get('/rhythms');
    const nap = rhythmOf('nap', nightOf({ on: '13:00', off: '15:00', alarms: [alarmAt('14:45')] }), { name: 'Nap' });
    const left = sideOf([body.data.left.rhythms.monday as Rhythm, nap], { monday: 'monday', saturday: 'nap' }, [
      { date: day(-10), rhythmId: null },
      { date: day(5), rhythmId: 'nap' },
    ]);
    const res = await post({ left });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.status, { enabled: true, active: true });
    assert.deepEqual(res.body.data.left.changes, [{ date: day(5), rhythmId: 'nap' }]);
    assert.deepEqual(res.body.data.right, body.data.right);
    const stored = JSON.parse(readFileSync(rhythmsFile, 'utf8'));
    assert.equal(stored.left.rhythms.nap.name, 'Nap');
  });

  it('GET /rhythms reports the flag being off and GET /rhythms/sleeps falls back to the weekly schedule', async () => {
    await updateSettings(draft => { draft.features.rhythms = false; });
    const status = await get('/rhythms');
    const sleeps = await get(MONDAY);
    await updateSettings(draft => { draft.features.rhythms = true; });
    assert.deepEqual(status.body.status, { enabled: false, active: false, reason: 'flag-off' });
    assert.notEqual(status.body.data, null);
    assert.equal(sleeps.body[0].rhythmId, null);
  });
});

describe('with an unreadable rhythms file', () => {
  before(() => {
    writeFileSync(rhythmsFile, '{"version": 1, "left": "not a side"}');
  });

  it('GET /rhythms gives only the reason', async () => {
    assert.deepEqual((await get('/rhythms')).body, { status: { enabled: true, active: false, reason: 'invalid' }, data: null });
  });

  it('POST /rhythms answers 409 without the file\'s errors', async () => {
    const res = await post({ left: sideOf() });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'The saved rhythms could not be read', state: 'invalid' });
  });

  it('GET /rhythms/sleeps falls back to the weekly schedule', async () => {
    assert.equal((await get(MONDAY)).body[0].rhythmId, null);
  });
});

describe('the weekly schedule file', () => {
  it('is byte for byte what the loader wrote, after every Rhythms call above', () => {
    assert.deepEqual(readFileSync(schedulesFile), schedulesBytes);
    assert.deepEqual(readdirSync(lowdb).sort(), ['rhythmsDB.json', 'schedulesDB.json', 'settingsDB.json']);
  });
});

describe('route setup', () => {
  it('mounts the Rhythms routes under /api', () => {
    const source = readFileSync(new URL('../../setup/routes.ts', import.meta.url), 'utf8');
    assert.match(source, /^import rhythms from '\.\.\/routes\/rhythms\/rhythms\.js';$/m);
    assert.match(source, /^ {2}app\.use\('\/api\/', rhythms\);$/m);
  });
});
