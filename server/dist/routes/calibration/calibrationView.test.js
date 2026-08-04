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
        const view = buildCalibrationView(null, null, null);
        assert.equal(view.state, 'none');
        assert.match(view.summary, /once the sensors record/i);
        assert.equal(view.quality, null);
    });
    it('summarises a calibrated profile with its window length', () => {
        const dailyRun = { status: 'success', trigger: 'daily' };
        const view = buildCalibrationView(profile, dailyRun, dailyRun);
        assert.equal(view.state, 'calibrated');
        // 1_700_001_320 - 1_700_000_000 is 1320s, which is 22 minutes.
        assert.match(view.summary, /22 min/);
        assert.equal(view.quality, 0.8);
    });
    it('distinguishes a carried-over profile from a genuinely poor one', () => {
        // Both have quality 0. Only the trigger of the run that produced the
        // profile tells them apart, and calling an import "poor" would be a
        // false claim about a measurement never taken.
        const migrationRun = { status: 'success', trigger: 'migration' };
        const dailyRun = { status: 'success', trigger: 'daily' };
        const imported = buildCalibrationView({ ...profile, quality: 0 }, migrationRun, migrationRun);
        const poor = buildCalibrationView({ ...profile, quality: 0 }, dailyRun, dailyRun);
        assert.equal(imported.state, 'imported');
        assert.match(imported.summary, /confidence unknown/i);
        assert.equal(poor.state, 'calibrated');
        assert.doesNotMatch(poor.summary, /confidence unknown/i);
    });
    it('keeps showing the active profile when the most recent run failed', () => {
        // The split schema exists so one bad night cannot erase a good profile.
        // The run that produced the profile succeeded; only the most recent,
        // unrelated run failed.
        const originatingRun = { status: 'success', trigger: 'daily' };
        const lastRun = { status: 'failed', trigger: 'daily' };
        const view = buildCalibrationView(profile, originatingRun, lastRun);
        assert.equal(view.state, 'calibrated');
        assert.equal(view.lastRunStatus, 'failed');
        assert.equal(view.quality, 0.8);
    });
    it('does not treat a skipped run as a failure', () => {
        const originatingRun = { status: 'success', trigger: 'daily' };
        const lastRun = { status: 'skipped_occupied', trigger: 'daily' };
        const view = buildCalibrationView(profile, originatingRun, lastRun);
        assert.equal(view.lastRunStatus, 'skipped_occupied');
        assert.equal(view.state, 'calibrated');
    });
    it('stays imported when a later run of any kind lands, keyed off the run that produced the active profile', () => {
        // profile.run_id points at the migration run that actually produced this
        // profile. A later daily run merely skipped (bed occupied); it did not
        // replace the profile. The view must still say 'imported' and must not
        // let the low-confidence wording attach to a quality-0 carry-over.
        const originatingRun = { status: 'success', trigger: 'migration' };
        const lastRun = { status: 'skipped_occupied', trigger: 'daily' };
        const view = buildCalibrationView({ ...profile, quality: 0 }, originatingRun, lastRun);
        assert.equal(view.state, 'imported');
        assert.doesNotMatch(view.summary, /low confidence/i);
        assert.equal(view.quality, null);
    });
});
//# sourceMappingURL=calibrationView.test.js.map