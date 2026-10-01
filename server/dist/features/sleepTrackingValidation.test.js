import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sleepTrackingExperimental } from './sleepTrackingValidation.js';
describe('sleepTrackingExperimental', () => {
    it('is not experimental on a Pod 5 writing capSense2', () => {
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', 'capSense2']), false);
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', null]), false);
    });
    it('is not experimental on a Pod 5 before any format is recorded', () => {
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', [null, undefined]), false);
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', []), false);
    });
    it('is experimental on any format other than capSense2, whatever the model says', () => {
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense', 'capSense']), true);
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', 'unknown']), true);
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['none', null]), true);
    });
    it('is experimental on any model but a Pod 5, whatever format it writes', () => {
        assert.equal(sleepTrackingExperimental('Pod 4', 'Pod 4', ['capSense2', 'capSense2']), true);
        assert.equal(sleepTrackingExperimental('Pod 4', 'Pod 4', [null, null]), true);
        assert.equal(sleepTrackingExperimental('Pod 3', 'Pod 3', ['capSense', null]), true);
        assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 4', ['capSense2', 'capSense2']), true);
        assert.equal(sleepTrackingExperimental('Version not found', 'Pod 5', ['capSense2', 'capSense2']), true);
        assert.equal(sleepTrackingExperimental(undefined, undefined, []), true);
    });
});
//# sourceMappingURL=sleepTrackingValidation.test.js.map