import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { NIGHT_END, NIGHT_START, flappingNight } from './sleepNightFixture.js';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-score-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
process.env.DATABASE_URL = `file:${folder}/score.db`;
const serverRoot = path.resolve(import.meta.dirname, '../../..');
execFileSync(process.execPath, [
  path.join(serverRoot, 'node_modules/prisma/build/index.js'),
  'migrate', 'deploy', '--schema', path.join(serverRoot, 'prisma/schema.prisma'),
], { env: process.env, stdio: 'pipe', timeout: 60_000 });
const { summarizeStages } = await import('./sleepStages.js');
const { durationComponent, default: router } = await import('./sleepScore.js');
const { prisma } = await import('../../db/prisma.js');
const { default: settingsDB } = await import('../../db/settings.js');
const { default: servicesDB } = await import('../../db/services.js');

const app = express();
app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await prisma.$disconnect();
  rmSync(folder, { recursive: true, force: true });
});

const IN_BED_SECONDS = 5 * 3600 + 46 * 60;

// Same arithmetic and format as the app's night headline.
function headline(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
}

test('duration scores the same asleep time the stages headline shows', () => {
  const { vitals, movements } = flappingNight();
  const stages = summarizeStages(vitals, movements, NIGHT_START, NIGHT_END);
  const asleep = stages.totals.light + stages.totals.rem + stages.totals.deep;
  const component = durationComponent(IN_BED_SECONDS, stages);
  assert.equal(component.value, `${headline(asleep)} asleep`);
  assert.equal(component.score, Math.round(100 - Math.abs(asleep / 3600 - 8) * 10));
});

test('duration falls back to time in bed when vitals coverage is low', () => {
  const stages = summarizeStages([], [], NIGHT_START, NIGHT_END);
  assert.equal(stages.lowCoverage, true);
  const component = durationComponent(IN_BED_SECONDS, stages);
  assert.equal(component.value, '5h 46m in bed');
  assert.equal(component.score, 78);
});

test('whole hours drop the minutes like the app does', () => {
  const component = durationComponent(8 * 3600, summarizeStages([], [], NIGHT_START, NIGHT_END));
  assert.equal(component.value, '8h in bed');
  assert.equal(component.score, 100);
});

async function scoreFor(side: 'left' | 'right', from: number) {
  await settingsDB.read();
  settingsDB.data.features.sleepScore = true;
  await settingsDB.write();
  await servicesDB.read();
  servicesDB.data.biometrics.enabled = true;
  await servicesDB.write();
  const query = new URLSearchParams({
    side,
    startTime: new Date(from * 1000).toISOString(),
    endTime: new Date((from + 3600) * 1000).toISOString(),
  });
  return (await fetch(`${base}/sleep-score?${query}`)).json() as Promise<{
    score: number; components: Record<string, { score: number; weight: number; value: string; available: boolean }>;
  }>;
}

test('never uses HRV, whatever the stored values', async () => {
  const night = 1790600400;
  await prisma.$executeRawUnsafe(`INSERT INTO vitals (side, timestamp, heart_rate, hrv, breathing_rate) VALUES
    ('left', ${night}, 60, 60, 13), ('left', ${night + 60}, 58, 70, 13), ('left', ${night + 120}, 59, 80, 13),
    ('right', ${night}, 60, 0, 13), ('right', ${night + 60}, 58, 0, 13), ('right', ${night + 120}, 59, 0, 13)`);
  const withHrv = await scoreFor('left', night);
  const withoutHrv = await scoreFor('right', night);
  assert.deepEqual(withHrv.components.hrv, { score: 0, weight: 0.15, value: '', available: false });
  assert.deepEqual(withoutHrv.components.hrv, withHrv.components.hrv);
  assert.equal(withHrv.score, withoutHrv.score);
});
