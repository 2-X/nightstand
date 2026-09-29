import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUCKET, NIGHT_END, NIGHT_START, flappingNight } from './sleepNightFixture.js';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-stages-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { summarizeStages, toStageVitals } = await import('./sleepStages.js');
test('missing vitals do not push sleep onset to the end of a flapping night', () => {
    const { vitals, movements } = flappingNight();
    const summary = summarizeStages(vitals, movements, NIGHT_START, NIGHT_END);
    assert.ok(summary.asleepSeconds > 5 * 3600, `asleep ${summary.asleepSeconds}s`);
    assert.equal(summary.asleepSeconds, summary.totals.light + summary.totals.rem + summary.totals.deep);
    assert.equal(summary.lowCoverage, false);
});
function nightFrom(heartRates, movement) {
    const vitals = heartRates.flatMap((heartRate, bucket) => heartRate === null ? [] : [{
            timestamp: NIGHT_START + bucket * BUCKET, heart_rate: heartRate, hrv: null, breathing_rate: null,
        }]);
    const movements = heartRates.map((_, bucket) => ({ timestamp: NIGHT_START + bucket * BUCKET, total_movement: movement(bucket) }));
    return summarizeStages(vitals, movements, NIGHT_START, NIGHT_START + heartRates.length * BUCKET);
}
test('a bucket without vitals and with low movement neither counts as calm nor breaks the calm run', () => {
    const summary = nightFrom([60, 60, null, 60, 90, null, 60, 60, 60], bucket => bucket === 4 || bucket === 5 ? 20 : 1);
    assert.notEqual(summary.epochs[0].stage, 'awake');
    assert.equal(summary.lowCoverage, false);
});
test('low vitals coverage skips the onset relabel and is reported', () => {
    const summary = nightFrom([77, null, null, 77, null, null, 60, 60, null, 60], bucket => bucket === 1 || bucket === 2 ? 10 : 0);
    assert.equal(summary.totals.awake, 0);
    assert.equal(summary.lowCoverage, true);
});
test('zero HRV and breathing rate are read as missing estimates', () => {
    assert.deepEqual(toStageVitals({ timestamp: 1, heart_rate: 70, hrv: 0, breathing_rate: 0 }), { timestamp: 1, heart_rate: 70, hrv: null, breathing_rate: null });
    assert.deepEqual(toStageVitals({ timestamp: 1, heart_rate: 70, hrv: 42, breathing_rate: 14 }), { timestamp: 1, heart_rate: 70, hrv: 42, breathing_rate: 14 });
});
test('unknown buckets right after the last sleep stay asleep, but not after a real waking', () => {
    // A restless hour before sleep sets the calm-movement threshold, as on a real night.
    const restless = Array(16).fill(90);
    const asleep = Array(12).fill(60);
    const quiet = (from) => (bucket) => bucket < 16 ? 100 : bucket === from ? 500 : 1;
    const stillSleeping = nightFrom([...restless, ...asleep, null, null, null], quiet(-1));
    assert.deepEqual(stillSleeping.epochs.slice(-3).map(e => e.stage === 'awake'), [false, false, false]);
    const wokeUp = nightFrom([...restless, ...asleep, 95, null, null], quiet(28));
    assert.deepEqual(wokeUp.epochs.slice(-3).map(e => e.stage), ['awake', 'awake', 'awake']);
});
test('a night with almost no recorded movement still finds sleep onset', () => {
    const summary = nightFrom([90, 90, 90, 90, ...Array(12).fill(60)], () => 0);
    assert.deepEqual(summary.epochs.slice(0, 4).map(e => e.stage), ['awake', 'awake', 'awake', 'awake']);
    assert.notEqual(summary.epochs[4].stage, 'awake');
});
//# sourceMappingURL=sleepStages.test.js.map