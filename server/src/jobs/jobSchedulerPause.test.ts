import assert from 'node:assert/strict';
import { after, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';

// Settings on disk as the server finds them at boot: one pause ended while
// the server was down, the other is still running.
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-pause-startup-'));
mkdirSync(path.join(folder, 'lowdb'));
const ended = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const running = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
writeFileSync(path.join(folder, 'lowdb', 'settingsDB.json'), JSON.stringify({
  timeZone: 'UTC',
  left: { scheduleOverrides: { pause: { active: true, expiresAt: ended } } },
  right: { scheduleOverrides: { pause: { active: true, expiresAt: running } } },
}));
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

it('clears an ended pause at startup and arms the resume job for a running one', async () => {
  const { default: status } = await import('../serverStatus.js');
  await import('./jobScheduler.js');
  const deadline = Date.now() + 5000;
  while (status.status.jobs.status !== 'healthy' && status.status.jobs.status !== 'failed') {
    assert.ok(Date.now() < deadline, 'scheduler did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(status.status.jobs.status, 'healthy');
  const saved = JSON.parse(readFileSync(path.join(folder, 'lowdb', 'settingsDB.json'), 'utf8'));
  assert.deepEqual(saved.left.scheduleOverrides.pause, { active: false, expiresAt: '' });
  assert.deepEqual(saved.right.scheduleOverrides.pause, { active: true, expiresAt: running });
  assert.equal(schedule.scheduledJobs['left-pause-resume'], undefined);
  assert.equal(schedule.scheduledJobs['right-pause-resume']?.nextInvocation()?.getTime(), Date.parse(running) + 60 * 1000);
});
