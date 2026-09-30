import assert from 'node:assert/strict';
import { after, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-rebuild-health-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
mock.module('chokidar', { defaultExport: { watch: () => ({ on: () => undefined }) } });
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => {} },
});

after(async () => {
  await schedule.gracefulShutdown();
  rmSync(folder, { recursive: true, force: true });
});

const scheduleKeys = [
  'alarmSchedule', 'primeSchedule', 'powerSchedule', 'rebootSchedule', 'temperatureSchedule',
] as const;

it('clears old failure messages from the schedule rows a rebuild marks healthy', async () => {
  const { default: status } = await import('../serverStatus.js');
  for (const key of scheduleKeys) {
    status.status[key].status = 'failed';
    status.status[key].message = 'Pod command failed';
  }
  await import('./jobScheduler.js');
  const deadline = Date.now() + 5000;
  while (status.status.jobs.status !== 'healthy' && status.status.jobs.status !== 'failed') {
    assert.ok(Date.now() < deadline, 'scheduler did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  for (const key of scheduleKeys) {
    assert.equal(status.status[key].status, 'healthy', key);
    assert.equal(status.status[key].message, '', key);
  }
});
