import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import moment from 'moment-timezone';
import { nightBounds } from './nightBounds.js';

const cases = JSON.parse(readFileSync(new URL('../../../fixtures/nightBounds.json', import.meta.url), 'utf8')) as {
  name: string; date: string; zone: string; power: { on: string; off: string }; start: string; end: string;
}[];
for (const entry of cases) {
  test(`night bounds preserve local times for ${entry.name}`, () => {
    const date = moment.tz(entry.date, entry.zone);
    const { start, end } = nightBounds(date, entry.power);
    assert.equal(start.format(), entry.start);
    assert.equal(end.format(), entry.end);
    assert.equal(date.format('HH:mm'), '00:00');
  });
}
