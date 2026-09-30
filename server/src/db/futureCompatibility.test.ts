import assert from 'node:assert/strict';
import { after, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import schedule from 'node-schedule';

const folder = mkdtempSync(path.join(tmpdir(), 'future-compat-'));
const lowdb = path.join(folder, 'lowdb');
mkdirSync(lowdb);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/compat/future/${name}.json`, import.meta.url), 'utf8'));
for (const name of ['settingsDB', 'schedulesDB', 'servicesDB', 'rhythmsDB']) {
  writeFileSync(path.join(lowdb, `${name}.json`), JSON.stringify(fixture(name)));
}
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
let change: (file: string) => void;
mock.module('chokidar', { defaultExport: { watch: () => ({ on: (_event: string, handler: typeof change) => { change = handler; } }) } });
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => {} },
});
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'scheduler did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
after(async () => {
  await schedule.gracefulShutdown();
  rmSync(folder, { recursive: true, force: true });
});

it('preserves upstream tap preferences and retired feature keys', async () => {
  const { default: db } = await import('./settings.js');
  assert.equal(db.data.left.taps.doubleTap.type === 'temperature' && db.data.left.taps.doubleTap.amount, 1);
  assert.deepEqual(db.data.left.taps.quadTap, fixture('settingsDB').left.taps.quadTap);
  assert.deepEqual(db.data.right.taps.quadTap, { type: 'base_control', behavior: 'toggle_preset' });
  assert.equal(db.data.right.taps.doubleTap.type === 'temperature' && db.data.right.taps.doubleTap.amount, 2);
  assert.equal((db.data.features as unknown as Record<string, unknown>).logsViewer, false);
});

it('loads future schedules without treating unknown fields as sides or days', async () => {
  const { default: db } = await import('./schedules.js');
  assert.equal(db.data.left.monday.alarm.time, '06:17');
  assert.equal(db.data.left.monday.alarm.duration, 27);
  assert.equal(db.data.left.monday.alarm.enabled, false);
  assert.deepEqual(db.data.left.monday.alarms, []);
  assert.equal(db.data.right.monday.alarm.time, '09:00');
});

it('keeps future keys through narrow POST flows and schedules only known days', async () => {
  const { default: settingsDB } = await import('./settings.js');
  const { default: schedulesDB } = await import('./schedules.js');
  await import('./services.js');
  const app = express();
  app.use(express.json());
  app.use((await import('../routes/settings/settings.js')).default);
  app.use((await import('../routes/schedules/schedules.js')).default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const patches = [
      ['settings', { left: { name: 'Sleeper' } }],
      ['schedules', { left: { monday: { power: { onTemperature: 80 } } } }],
    ] as const;
    for (const [route, body] of patches) {
      const response: Awaited<ReturnType<typeof fetch>> = await fetch(`http://127.0.0.1:${address.port}/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      await response.json();
    }
    for (const name of ['settingsDB', 'schedulesDB', 'servicesDB', 'rhythmsDB']) {
      const saved = JSON.parse(readFileSync(path.join(lowdb, `${name}.json`), 'utf8'));
      const input = fixture(name);
      for (const key of ['futureTop', 'futureSide', 'strayScalar', 'sentryLogging', 'futureService']) {
        if (key in input) assert.deepEqual(saved[key], input[key]);
      }
      if (name === 'settingsDB') {
        assert.deepEqual(saved.left.futureSide, input.left.futureSide);
        assert.deepEqual(saved.left.scheduleOverrides.pause, input.left.scheduleOverrides.pause);
        assert.equal(saved.features.rhythms, true);
        assert.equal(saved.features.futureFeature, true);
      }
      if (name === 'schedulesDB') {
        assert.deepEqual(saved.left.futureDay, input.left.futureDay);
        assert.deepEqual(saved.left.monday.futureDay, input.left.monday.futureDay);
      }
    }
    const { default: status } = await import('../serverStatus.js');
    await import('../jobs/jobScheduler.js');
    await waitFor(() => status.status.jobs.status !== 'started');
    assert.equal(status.status.jobs.status, 'healthy');
    const futureJobs = Object.keys(schedule.scheduledJobs).sort();
    const known = JSON.parse(JSON.stringify(schedulesDB.data));
    delete known.futureSide;
    delete known.strayScalar;
    delete known.left.futureDay;
    delete known.left.monday.futureDay;
    writeFileSync(path.join(lowdb, 'schedulesDB.json'), JSON.stringify(known));
    change('schedulesDB.json');
    await waitFor(() => status.status.jobs.status !== 'started');
    assert.deepEqual(Object.keys(schedule.scheduledJobs).sort(), futureJobs);

    let reads = 0;
    const originalRead = settingsDB.read.bind(settingsDB);
    const readMock = mock.method(settingsDB, 'read', async () => { reads++; await originalRead(); });
    for (const name of ['rhythmsDB.json', '.rhythmsDB.json.tmp', 'servicesDB.json', '.servicesDB.json.tmp', 'unrelated.json']) change(name);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reads, 0, 'unrelated writes rebuilt jobs');
    readMock.mock.restore();

    let release!: () => void;
    let blocked = false;
    const originalScheduleRead = schedulesDB.read.bind(schedulesDB);
    const scheduleReadMock = mock.method(schedulesDB, 'read', async () => {
      await originalScheduleRead();
      if (!blocked) {
        blocked = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
    });
    change('settingsDB.json');
    await waitFor(() => blocked);
    known.left.monday.power.on = '22:12';
    writeFileSync(path.join(lowdb, 'schedulesDB.json'), JSON.stringify(known));
    change('.schedulesDB.json.tmp');
    release();
    await waitFor(() => Boolean(schedule.scheduledJobs['left-monday-22:12-power-on']));
    assert.equal(schedule.scheduledJobs['left-monday-21:00-power-on'], undefined);
    assert.equal(status.status.jobs.status, 'healthy');
    scheduleReadMock.mock.restore();
    assert.equal(
      readFileSync(path.join(lowdb, 'rhythmsDB.json'), 'utf8'), JSON.stringify(fixture('rhythmsDB')), 'nothing rewrote rhythmsDB.json',
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
