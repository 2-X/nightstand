import assert from 'node:assert/strict';
import { it, mock } from 'node:test';

const reboots: string[] = [];
const logs: string[] = [];
let activeUnit = '';
let checkFailed = false;
let dailyJob: (() => Promise<void>) | undefined;
mock.module('child_process', { namedExports: {
  exec: (command: string) => reboots.push(command),
  execFile: (_command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    callback(checkFailed ? new Error('check failed') : null, args.includes(activeUnit) ? 'active' : 'inactive');
  },
} });
mock.module(new URL('../logger.js', import.meta.url).href, { defaultExport: {
  debug: () => {}, info: (message: string) => logs.push(message), error: () => {},
} });
mock.module('node-schedule', { defaultExport: {
  RecurrenceRule: class {},
  scheduleJob: (name: string, _rule: unknown, callback: () => Promise<void>) => {
    if (name.startsWith('daily-reboot')) dailyJob = callback;
  },
} });
mock.module(new URL('../db/settings.js', import.meta.url).href, { defaultExport: { read: async () => {}, data: { rebootDaily: true } } });
mock.module(new URL('../db/services.js', import.meta.url).href, { defaultExport: {} });
mock.module(new URL('../serverStatus.js', import.meta.url).href, { defaultExport: { status: { alarmSchedule: {} } } });
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => {} },
});
mock.module(new URL('./calibrateSensors.js', import.meta.url).href, { namedExports: { executeCalibrateSensors: () => {} } });
const { default: reboot } = await import('./reboot.js');
const { schedulePrimingRebootAndCalibration } = await import('./primeScheduler.js');

for (const unit of ['free-sleep-update.service', 'free-sleep-rollback.service', 'free-sleep-revert.service']) {
  it(`refuses manual and skips daily reboot while ${unit} runs`, async () => {
    activeUnit = unit;
    reboots.length = 0;
    logs.length = 0;
    await assert.rejects(reboot(), /already running/);
    const settings = {
      timeZone: 'UTC', primePodDaily: { enabled: true, time: '14:00' },
    } as Parameters<typeof schedulePrimingRebootAndCalibration>[0];
    schedulePrimingRebootAndCalibration(settings);
    assert.ok(dailyJob);
    await dailyJob();
    assert.equal(reboots.length, 0);
    assert.ok(logs.some(message => /Skipping daily reboot.*already running/.test(message)));
    activeUnit = '';
  });
}
it('fails closed when operation state cannot be read and reboots when idle', async () => {
  checkFailed = true;
  await assert.rejects(reboot(), /Cannot check/);
  checkFailed = false;
  await reboot();
  assert.deepEqual(reboots, ['sudo /sbin/reboot']);
});
