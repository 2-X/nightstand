import assert from 'node:assert/strict';
import { describe, it, before, after, mock } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nodeSchedule from 'node-schedule';

// Same isolated-temp-DATA_FOLDER pattern as db/services.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-jobsched-probe-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

// The pod NTP-syncs some time after boot, so the clock starts invalid and
// becomes valid later. This flag stands in for that transition.
let dateValid = false;

// chokidar is mocked so the watcher is fully deterministic (and so it does
// not keep the event loop alive after the test file finishes). We keep the
// registered change handler and call it ourselves to simulate a DB write.
const changeHandlers: Array<(p: string) => void> = [];

mock.module('chokidar', {
  defaultExport: {
    watch: () => {
      const watcher = {
        on(event: string, cb: (p: string) => void) {
          if (event === 'change') changeHandlers.push(cb);
          return watcher;
        },
      };
      return watcher;
    },
  },
});

mock.module(new URL('./isSystemDateValid.js', import.meta.url).href, {
  namedExports: { isSystemDateValid: () => dateValid },
});

mock.module(new URL('../routes/deviceStatus/updateDeviceStatus.js', import.meta.url).href, {
  namedExports: { updateDeviceStatus: async () => {} },
});

let settingsDB: typeof import('../db/settings.js')['default'];
let schedulesDB: typeof import('../db/schedules.js')['default'];

// Real setTimeout, captured before the fake timers below replace it, so we
// can still yield genuine event-loop turns for lowdb's file reads.
const realSetTimeout = globalThis.setTimeout;

// setupJobs() awaits several lowdb file reads (settings, schedules, and now
// recurringAlarms). Each read is an async fs round-trip, so give the flush
// enough event-loop turns to drain them all even when the test runner is
// running many files in parallel and starving this process of CPU.
async function flush() {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 1));
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Fake setTimeout so the 5-second retry loop can be fast-forwarded. Enabled
// at module scope because jobScheduler starts that loop at import time.
mock.timers.enable({ apis: ['setTimeout'] });

before(async () => {
  ({ default: settingsDB } = await import('../db/settings.js'));
  ({ default: schedulesDB } = await import('../db/schedules.js'));

  await settingsDB.read();
  settingsDB.data.timeZone = 'UTC';
  settingsDB.data.left.awayMode = false;
  await settingsDB.write();

  await schedulesDB.read();
  schedulesDB.data.left.monday.power = { on: '21:00', off: '23:00', enabled: true, onTemperature: 82 };
  await schedulesDB.write();

  // jobScheduler kicks off its retry loop at import time, so the clock must
  // already be "wrong" and setTimeout already faked before we import it.
  await import('./jobScheduler.js');
  await flush();
});

after(() => {
  Object.keys(nodeSchedule.scheduledJobs).forEach((name) => nodeSchedule.cancelJob(name));
});

const POWER_ON_JOB = 'left-monday-21:00-power-on';

describe('jobScheduler system-date retry', () => {
  it('schedules jobs once the clock becomes valid, even if the retries ran out first', async () => {
    // Boot with a bad clock. jobScheduler retries 20 times, 5s apart, so it
    // gives up 100 seconds after boot.
    assert.equal(nodeSchedule.scheduledJobs[POWER_ON_JOB], undefined, 'jobs scheduled with an invalid clock');

    // Burn well past the retry budget (25 * 5s = 125s).
    for (let i = 0; i < 25; i++) {
      mock.timers.tick(5_000);
      await flush();
    }

    // NTP finally lands, 3 minutes after boot. Nothing else on the pod
    // writes to schedulesDB/settingsDB on its own, so no DB-change event is
    // coming: the scheduler has to notice on its own.
    dateValid = true;
    for (let i = 0; i < 12; i++) {
      mock.timers.tick(60_000);
      await flush();
    }

    assert.ok(
      nodeSchedule.scheduledJobs[POWER_ON_JOB],
      'no jobs were ever scheduled after the clock became valid',
    );
  });

  it('recovers when something later writes to a watched DB file', async () => {
    dateValid = true;
    assert.equal(changeHandlers.length > 0, true, 'no chokidar change handler registered');
    changeHandlers[0]('/tmp/lowdb/schedulesDB.json');
    await flush();
    assert.ok(nodeSchedule.scheduledJobs[POWER_ON_JOB], 'a DB change did not reschedule jobs');
  });
});
