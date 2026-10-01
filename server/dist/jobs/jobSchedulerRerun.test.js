import assert from 'node:assert/strict';
import { after, before, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import schedule from 'node-schedule';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-setupjobs-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
mock.module('chokidar', { defaultExport: { watch: () => ({ on: () => undefined }) } });
mock.module(new URL('./isSystemDateValid.js', import.meta.url).href, {
    namedExports: { isSystemDateValid: () => true },
});
mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
    namedExports: { updateDeviceStatus: async () => { } },
});
const { default: settingsDB } = await import('../db/settings.js');
const { default: schedulesDB } = await import('../db/schedules.js');
let setupJobs;
before(async () => {
    settingsDB.data.timeZone = 'UTC';
    await settingsDB.write();
    schedulesDB.data.left.monday.power = { on: '21:00', off: '07:00', enabled: true, onTemperature: 80 };
    await schedulesDB.write();
    ({ setupJobs } = await import('./jobScheduler.js'));
    await setupJobs();
});
after(async () => {
    Object.keys(schedule.scheduledJobs).forEach(name => schedule.cancelJob(name));
    await schedule.gracefulShutdown();
    rmSync(folder, { recursive: true, force: true });
});
it('an awaited setupJobs settles only after a pass that read the latest files', async () => {
    assert.ok(schedule.scheduledJobs['left-monday-21:00-power-on'], 'the first rebuild did not run');
    let release;
    let blocked = false;
    const originalRead = schedulesDB.read.bind(schedulesDB);
    const readMock = mock.method(schedulesDB, 'read', async () => {
        await originalRead();
        if (!blocked) {
            blocked = true;
            await new Promise(resolve => { release = resolve; });
        }
    });
    try {
        const first = setupJobs();
        while (!blocked)
            await new Promise(resolve => setTimeout(resolve, 5));
        const next = structuredClone(schedulesDB.data);
        next.left.monday.power.on = '22:12';
        writeFileSync(path.join(folder, 'lowdb', 'schedulesDB.json'), JSON.stringify(next));
        const second = setupJobs();
        release();
        await second;
        assert.ok(schedule.scheduledJobs['left-monday-22:12-power-on'], 'the awaited rebuild missed the change');
        assert.equal(schedule.scheduledJobs['left-monday-21:00-power-on'], undefined);
        await first;
    }
    finally {
        readMock.mock.restore();
    }
});
//# sourceMappingURL=jobSchedulerRerun.test.js.map