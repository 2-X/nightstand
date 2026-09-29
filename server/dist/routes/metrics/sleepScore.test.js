import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NIGHT_END, NIGHT_START, flappingNight } from './sleepNightFixture.js';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-score-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { summarizeStages } = await import('./sleepStages.js');
const { durationComponent } = await import('./sleepScore.js');
const IN_BED_SECONDS = 5 * 3600 + 46 * 60;
// Same arithmetic and format as the app's night headline.
function headline(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
}
test('duration scores the same asleep time the stages headline shows', () => {
    const { vitals, movements } = flappingNight();
    const stages = summarizeStages(vitals, movements, NIGHT_START, NIGHT_END);
    const asleep = stages.totals.light + stages.totals.rem + stages.totals.deep;
    const component = durationComponent(IN_BED_SECONDS, stages);
    assert.equal(component.value, `${headline(asleep)} asleep`);
    assert.equal(component.score, Math.round(100 - Math.abs(asleep / 3600 - 8) * 10));
});
test('duration falls back to time in bed when vitals coverage is low', () => {
    const stages = summarizeStages([], [], NIGHT_START, NIGHT_END);
    assert.equal(stages.lowCoverage, true);
    const component = durationComponent(IN_BED_SECONDS, stages);
    assert.equal(component.value, '5h 46m in bed');
    assert.equal(component.score, 78);
});
test('whole hours drop the minutes like the app does', () => {
    const component = durationComponent(8 * 3600, summarizeStages([], [], NIGHT_START, NIGHT_END));
    assert.equal(component.value, '8h in bed');
    assert.equal(component.score, 100);
});
//# sourceMappingURL=sleepScore.test.js.map