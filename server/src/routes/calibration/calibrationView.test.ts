import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCalibrationView } from './calibrationView.js';

const profile = {
  quality: 0.8,
  source_start: 1_700_000_000,
  source_end: 1_700_001_320,
  created_at: 1_700_001_400,
};

describe('buildCalibrationView', () => {
  it('reports the never-calibrated state without implying failure', () => {
    const view = buildCalibrationView(null, null);
    assert.equal(view.state, 'none');
    assert.match(view.summary, /once the sensors record/i);
    assert.equal(view.quality, null);
  });

  it('summarises a calibrated profile with its window length', () => {
    const view = buildCalibrationView(profile, { status: 'success', trigger: 'daily' });
    assert.equal(view.state, 'calibrated');
    // 1_700_001_320 - 1_700_000_000 is 1320s, which is 22 minutes.
    assert.match(view.summary, /22 min/);
    assert.equal(view.quality, 0.8);
  });

  it('distinguishes a carried-over profile from a genuinely poor one', () => {
    // Both have quality 0. Only the trigger tells them apart, and calling an
    // import "poor" would be a false claim about a measurement never taken.
    const imported = buildCalibrationView(
      { ...profile, quality: 0 }, { status: 'success', trigger: 'migration' },
    );
    const poor = buildCalibrationView(
      { ...profile, quality: 0 }, { status: 'success', trigger: 'daily' },
    );

    assert.equal(imported.state, 'imported');
    assert.match(imported.summary, /confidence unknown/i);
    assert.equal(poor.state, 'calibrated');
    assert.doesNotMatch(poor.summary, /confidence unknown/i);
  });

  it('keeps showing the active profile when the most recent run failed', () => {
    // The split schema exists so one bad night cannot erase a good profile.
    const view = buildCalibrationView(profile, { status: 'failed', trigger: 'daily' });
    assert.equal(view.state, 'calibrated');
    assert.equal(view.lastRunStatus, 'failed');
    assert.equal(view.quality, 0.8);
  });

  it('does not treat a skipped run as a failure', () => {
    const view = buildCalibrationView(profile, { status: 'skipped_occupied', trigger: 'daily' });
    assert.equal(view.lastRunStatus, 'skipped_occupied');
    assert.equal(view.state, 'calibrated');
  });
});
