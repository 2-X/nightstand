import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldDisableBiometrics } from './biometrics.js';
// Regression test: toggling the Settings biometrics switch off used to only
// write `biometrics.enabled: false` to the DB, leaving free-sleep-stream.service
// running indefinitely. shouldDisableBiometrics gates the fix (services.ts
// calls triggerBiometricsDisable when this is true); cover the decision logic
// without spawning a real process.
describe('shouldDisableBiometrics', () => {
    it('is true when the request explicitly turns biometrics off', () => {
        assert.equal(shouldDisableBiometrics({ biometrics: { enabled: false } }), true);
    });
    it('is false when the request turns biometrics on', () => {
        assert.equal(shouldDisableBiometrics({ biometrics: { enabled: true } }), false);
    });
    it('is false when the request does not touch biometrics.enabled at all', () => {
        // deepPartial() bodies (e.g. a job-status POST) can omit `enabled`
        // entirely: must not misread absence as "turn it off".
        assert.equal(shouldDisableBiometrics({}), false);
        assert.equal(shouldDisableBiometrics({ biometrics: {} }), false);
    });
});
//# sourceMappingURL=biometrics.test.js.map