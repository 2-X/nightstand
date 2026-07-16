import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSleepScoreActive } from './sleepScoreGuard.js';
const settings = (sleepScore) => ({ features: { sleepScore } });
const services = (biometricsEnabled) => ({ biometrics: { enabled: biometricsEnabled } });
describe('isSleepScoreActive', () => {
    it('is active when both the flag and biometrics are on', () => {
        assert.equal(isSleepScoreActive(settings(true), services(true)), true);
    });
    it('is inactive when the flag is off, even if biometrics is on', () => {
        assert.equal(isSleepScoreActive(settings(false), services(true)), false);
    });
    it('is inactive when biometrics is off, even if the flag is on (the depends_on relationship)', () => {
        assert.equal(isSleepScoreActive(settings(true), services(false)), false);
    });
    it('is inactive when both are off', () => {
        assert.equal(isSleepScoreActive(settings(false), services(false)), false);
    });
});
//# sourceMappingURL=sleepScoreGuard.test.js.map