import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMetricsQuery, parseNightQuery } from './metricsQuery.js';
test('reads a side and a Pod-local time range', () => {
    assert.deepEqual(parseMetricsQuery({ side: 'left', startTime: '2026-09-28T23:45:30-07:00', endTime: '2026-09-29T06:44:52.000Z' }), { side: 'left', start: 1790664330, end: 1790664292 });
    assert.deepEqual(parseMetricsQuery({}), { side: undefined, start: undefined, end: undefined });
    assert.deepEqual(parseMetricsQuery({ side: '' }), { side: undefined, start: undefined, end: undefined });
});
test('rejects values the database query cannot use', () => {
    for (const query of [
        { startTime: 'garbage' }, { startTime: '-99999999999' }, { startTime: '99999999999999999999' },
        { startTime: '2026-02-30T25:61:00Z' }, { startTime: 'undefined', endTime: 'null' }, { startTime: ['0'] },
        { side: ['left', 'right'] }, { side: 'middle' },
    ]) {
        assert.equal(parseMetricsQuery(query), null, JSON.stringify(query));
    }
});
test('reads one night for stages and scores', () => {
    assert.deepEqual(parseNightQuery({ side: 'right', startTime: '2026-09-28T21:51:00-07:00', endTime: '2026-09-29T05:44:00-07:00' }), { side: 'right', start: 1790657460, end: 1790685840 });
});
test('refuses a night query that is incomplete, reversed or longer than two days', () => {
    for (const query of [
        { side: 'left', startTime: '2026-09-28T21:51:00-07:00' },
        { startTime: '2026-09-28T21:51:00-07:00', endTime: '2026-09-29T05:44:00-07:00' },
        { side: 'left', startTime: '2026-09-29T05:44:00-07:00', endTime: '2026-09-28T21:51:00-07:00' },
        { side: 'left', startTime: '2026-09-27T20:00:00-07:00', endTime: '9999-12-31T00:00:00Z' },
        { side: 'left', startTime: 'garbage', endTime: '2026-09-29T05:44:00-07:00' },
    ]) {
        assert.equal(parseNightQuery(query), null, JSON.stringify(query));
    }
});
//# sourceMappingURL=metricsQuery.test.js.map