import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// config.ts needs these before the settings db module loads. The stored doc
// predates the switch, as it does on every pod updating into this version.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-biometrics-v2-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
writeFileSync(path.join(dataFolder, 'lowdb', 'settingsDB.json'), JSON.stringify({ features: { sleepScore: true } }));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let settingsDB;
let biometricsV2Enabled;
before(async () => {
    ({ default: settingsDB } = await import('../db/settings.js'));
    ({ biometricsV2Enabled } = await import('./biometricsV2.js'));
});
describe('biometricsV2Enabled', () => {
    it('is off for settings written before the switch existed', () => {
        assert.equal(settingsDB.data.features.biometricsV2, false);
        assert.equal(biometricsV2Enabled(), false);
    });
    it('follows the setting', () => {
        settingsDB.data.features.biometricsV2 = true;
        assert.equal(biometricsV2Enabled(), true);
        settingsDB.data.features.biometricsV2 = false;
        assert.equal(biometricsV2Enabled(), false);
    });
    it('is off when the key is missing from a degraded settings object', () => {
        const features = settingsDB.data.features;
        const original = features.biometricsV2;
        delete features.biometricsV2;
        try {
            assert.equal(biometricsV2Enabled(), false);
        }
        finally {
            features.biometricsV2 = original;
        }
    });
});
//# sourceMappingURL=biometricsV2.test.js.map