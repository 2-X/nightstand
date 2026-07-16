import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { wouldOrphanLevelFormat } from './settingsGuards.js';
const levelSettings = { temperatureFormat: 'level' };
const fahrenheitSettings = { temperatureFormat: 'fahrenheit' };
describe('wouldOrphanLevelFormat', () => {
    it('rejects disabling when the stored format is level and the update does not touch it', () => {
        assert.equal(wouldOrphanLevelFormat(levelSettings, { features: { levelTemps: false } }), true);
    });
    it('rejects disabling when the update explicitly keeps the format at level', () => {
        assert.equal(wouldOrphanLevelFormat(levelSettings, { features: { levelTemps: false }, temperatureFormat: 'level' }), true);
    });
    it('allows disabling when the same update also moves the format away from level', () => {
        assert.equal(wouldOrphanLevelFormat(levelSettings, { features: { levelTemps: false }, temperatureFormat: 'fahrenheit' }), false);
    });
    it('allows disabling when the stored format is not level', () => {
        assert.equal(wouldOrphanLevelFormat(fahrenheitSettings, { features: { levelTemps: false } }), false);
    });
    it('allows any update that does not touch the flag, regardless of format', () => {
        assert.equal(wouldOrphanLevelFormat(levelSettings, { temperatureFormat: 'level' }), false);
        assert.equal(wouldOrphanLevelFormat(levelSettings, {}), false);
    });
});
//# sourceMappingURL=settingsGuards.test.js.map