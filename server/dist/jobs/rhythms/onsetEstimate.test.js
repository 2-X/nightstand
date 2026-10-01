import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateOnset, ONSET_MIN_BASELINE_ROWS } from './onsetEstimate.js';
const MINUTE = 60_000;
const START = Date.parse('2026-09-30T05:45:00Z');
const repeat = (value, count) => Array.from({ length: count }, () => value);
const rows = (values, from = START) => values.map((hr, index) => ({ at: from + index * MINUTE, hr }));
// Baseline p10 = 51, so the calm threshold is 57 bpm.
const baseline = rows(Array.from({ length: ONSET_MIN_BASELINE_ROWS }, (_, index) => 50 + (index % 20)), START - 7 * 24 * 60 * MINUTE);
describe('estimateOnset', () => {
    it('fires after 10 calm rows of the 5-row median', () => {
        const night = rows([...repeat(70, 10), ...repeat(55, 20)]);
        // Median is calm from row 12 (index), so the 10th calm row is index 21.
        assert.deepEqual(estimateOnset(night, baseline), { at: START + 21 * MINUTE, note: 'hr-causal' });
    });
    it('restarts the run when the median rises', () => {
        const night = rows([...repeat(55, 8), ...repeat(75, 5), ...repeat(55, 20)]);
        const result = estimateOnset(night, baseline);
        assert.equal(result.note, 'hr-causal');
        assert.equal(result.at, START + 24 * MINUTE);
    });
    it('skips missing and out-of-range readings', () => {
        const night = rows([null, 30, 120, ...repeat(55, 14)]);
        assert.deepEqual(estimateOnset(night, baseline), { at: START + 16 * MINUTE, note: 'hr-causal' });
    });
    it('reports why there is no estimate', () => {
        assert.equal(estimateOnset([], baseline).note, 'no-vitals');
        assert.equal(estimateOnset(rows(repeat(55, 30)), baseline.slice(0, 10)).note, 'no-baseline');
        assert.deepEqual(estimateOnset(rows(repeat(70, 30)), baseline), { at: null, note: 'not-reached' });
    });
});
//# sourceMappingURL=onsetEstimate.test.js.map