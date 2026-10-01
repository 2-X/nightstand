import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sleepTrackingExperimental } from './sleepTrackingValidation.js';

describe('sleepTrackingExperimental', () => {
  it('is not experimental on a Pod 5 writing capSense2', () => {
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', 'capSense2']), false);
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', null]), false);
  });

  it('falls back to the model before any format is known', () => {
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', [null, undefined]), false);
    assert.equal(sleepTrackingExperimental('Pod 4', 'Pod 4', [null, null]), true);
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 4', []), true);
    assert.equal(sleepTrackingExperimental('Version not found', 'Pod 5', []), true);
    assert.equal(sleepTrackingExperimental(undefined, undefined, []), true);
  });

  it('is experimental on any format other than capSense2, whatever the model says', () => {
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense', 'capSense']), true);
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['capSense2', 'unknown']), true);
    assert.equal(sleepTrackingExperimental('Pod 5', 'Pod 5', ['none', null]), true);
  });

  it('lets a recorded validated format decide over the model', () => {
    assert.equal(sleepTrackingExperimental('Pod 4', 'Pod 4', ['capSense2', null]), false);
  });
});
