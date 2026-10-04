import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nightstand-vitals-'));
fs.mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
process.env.DATABASE_URL = `file:${folder}/vitals.db`;
const serverRoot = path.resolve(import.meta.dirname, '../../..');
execFileSync(process.execPath, [
    path.join(serverRoot, 'node_modules/prisma/build/index.js'),
    'migrate', 'deploy', '--schema', path.join(serverRoot, 'prisma/schema.prisma'),
], { env: process.env, stdio: 'pipe', timeout: 60_000 });
const { prisma } = await import('../../db/prisma.js');
const { default: settingsDB } = await import('../../db/settings.js');
const { default: router } = await import('./vitals.js');
const app = express();
app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
    fs.rmSync(folder, { recursive: true, force: true });
});
const NIGHT = 1790600400;
const LATER = NIGHT + 7200;
await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate) VALUES
  ('left', ${NIGHT}, 61, 45, 13), ('left', ${NIGHT + 60}, 63, 0, 0)`);
await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate,
  hr_quality, rmssd, sdnn, hrv_coverage, resp_rate, resp_quality, estimator) VALUES
  ('left', ${NIGHT + 120}, 104, 38, 16, 0.81, 41.3, 38.4, 0.82, 16.2, 0.9, 2),
  ('left', ${NIGHT + 180}, 60, 0, 0, NULL, NULL, NULL, 0.4, NULL, NULL, 2)`);
// A night recorded with the toggle off, read later with it on.
await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate) VALUES
  ('right', ${NIGHT}, 58, 50, 12), ('right', ${NIGHT + 60}, 62, 0, 0)`);
// Later on the right side: new-estimator rows whose breathing never passed its
// check, beside a legacy row that has one.
await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate) VALUES
  ('right', ${LATER}, 60, 0, 14)`);
await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate,
  hr_quality, rmssd, sdnn, hrv_coverage, resp_rate, resp_quality, estimator) VALUES
  ('right', ${LATER + 60}, 59, 0, 0, 0.8, NULL, NULL, 0.1, NULL, NULL, 2),
  ('right', ${LATER + 120}, 61, 0, 0, 0.8, NULL, NULL, 0.1, NULL, NULL, 2)`);
const range = (side, from) => new URLSearchParams({
    side,
    startTime: new Date(from * 1000).toISOString(),
    endTime: new Date((from + 3600) * 1000).toISOString(),
}).toString();
const get = async (route, side = 'left', from = NIGHT) => (await fetch(`${base}${route}?${range(side, from)}`)).text();
const setV2 = (on) => { settingsDB.data.features.biometricsV2 = on; };
describe('vitals with new sleep tracking off', () => {
    it('sends the rows exactly as releases before the new columns did', async () => {
        setV2(false);
        assert.equal(await get('/vitals'), JSON.stringify([
            { id: 1, side: 'left', timestamp: NIGHT, heart_rate: 61, hrv: 45, breathing_rate: 13 },
            { id: 2, side: 'left', timestamp: NIGHT + 60, heart_rate: 63, hrv: 0, breathing_rate: 0 },
            { id: 3, side: 'left', timestamp: NIGHT + 120, heart_rate: 104, hrv: 38, breathing_rate: 16 },
            { id: 4, side: 'left', timestamp: NIGHT + 180, heart_rate: 60, hrv: 0, breathing_rate: 0 },
        ]));
    });
    it('summarizes with the legacy filters', async () => {
        setV2(false);
        assert.equal(await get('/vitals/summary'), JSON.stringify({
            avgHeartRate: 72, minHeartRate: 60, maxHeartRate: 104, avgHRV: 42, avgBreathingRate: 15,
        }));
    });
});
describe('vitals with new sleep tracking on', () => {
    it('adds the new fields to every row', async () => {
        setV2(true);
        const rows = JSON.parse(await get('/vitals'));
        assert.deepEqual(Object.keys(rows[0]), [
            'id', 'side', 'timestamp', 'heart_rate', 'hrv', 'breathing_rate',
            'hr_quality', 'rmssd', 'sdnn', 'hrv_coverage', 'resp_rate', 'resp_quality', 'estimator',
        ]);
        assert.equal(rows[0].rmssd, null);
        assert.equal(rows[2].rmssd, 41.3);
        assert.equal(rows[2].resp_rate, 16.2);
        assert.equal(rows[2].estimator, 2);
    });
    it('summarizes breathing from the rows that have it and keeps the legacy HRV', async () => {
        setV2(true);
        assert.equal(await get('/vitals/summary'), JSON.stringify({
            avgHeartRate: 72, minHeartRate: 60, maxHeartRate: 104, avgHRV: 42, avgBreathingRate: 16,
        }));
    });
    it('shows no breathing for a night recorded without the new estimates', async () => {
        setV2(true);
        assert.equal(await get('/vitals/summary', 'right'), JSON.stringify({
            avgHeartRate: 60, minHeartRate: 58, maxHeartRate: 62, avgHRV: 50, avgBreathingRate: 0,
        }));
    });
    it('does not fall back to the legacy breathing column when new rows have no breathing', async () => {
        setV2(true);
        assert.equal(await get('/vitals/summary', 'right', LATER), JSON.stringify({
            avgHeartRate: 60, minHeartRate: 59, maxHeartRate: 61, avgHRV: 0, avgBreathingRate: 0,
        }));
    });
});
//# sourceMappingURL=vitals.test.js.map