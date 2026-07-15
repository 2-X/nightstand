import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// node --test isolates each test file into its own process, so this file can
// seed a servicesDB.json on disk *before* dynamically importing services.js,
// exercising the startup reconciliation that runs at module-load time, which
// services.test.ts (already imported in the same process for other cases)
// cannot re-trigger.
describe('servicesDB startup reconciliation', () => {
  it('marks a stale "started" job status as failed on load', async () => {
    const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-services-reconcile-test-'));
    mkdirSync(path.join(dataFolder, 'lowdb'));
    writeFileSync(
      path.join(dataFolder, 'lowdb', 'servicesDB.json'),
      JSON.stringify({
        biometrics: {
          enabled: true,
          jobs: {
            analyzeSleepLeft: {
              name: 'Analyze sleep - left',
              message: '',
              status: 'started',
              description: 'Analyzes sleep period',
              timestamp: '2026-07-09T19:00:04.352373+00:00',
            },
          },
        },
      }),
    );
    process.env.DATA_FOLDER = `${dataFolder}/`;
    process.env.ENV = 'local';

    const { default: servicesDB } = await import('./services.js');

    assert.equal(servicesDB.data.biometrics.jobs.analyzeSleepLeft.status, 'failed');
    assert.match(servicesDB.data.biometrics.jobs.analyzeSleepLeft.message, /Stale "started" status/);
  });
});
