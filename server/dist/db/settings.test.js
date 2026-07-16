import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// config.ts throws if these aren't set, and reading it is what sets
// lowDbFolder for the db module under test. Must run before the dynamic
// import below. A fresh temp dir keeps this test isolated from any real
// settingsDB.json on the machine running it.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-settings-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
// Simulate an old on-disk doc from before the `features` field existed:
// empty object, nothing for the module-load merge to backfill from.
writeFileSync(path.join(dataFolder, 'lowdb', 'settingsDB.json'), '{}');
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let settingsDB;
let defaultFeatures;
before(async () => {
    ({ default: settingsDB } = await import('./settings.js'));
    ({ defaultFeatures } = await import('./settingsSchema.js'));
});
describe('settingsDB defaultData merge', () => {
    it('backfills the features object on an old doc that predates it', () => {
        assert.deepEqual(settingsDB.data.features, defaultFeatures);
    });
});
//# sourceMappingURL=settings.test.js.map