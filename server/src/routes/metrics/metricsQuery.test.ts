import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROWS_SECONDS, MAX_ROWS_SECONDS, parseMetricsQuery, parseNightQuery, parseRowsQuery,
} from './metricsQuery.js';

test('reads a side and a Pod-local time range', () => {
  assert.deepEqual(parseMetricsQuery({ side: 'left', startTime: '2026-09-28T23:45:30-07:00', endTime: '2026-09-29T06:44:52.000Z' }),
    { side: 'left', start: 1790664330, end: 1790664292 });
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
  assert.deepEqual(parseNightQuery({ side: 'right', startTime: '2026-09-28T21:51:00-07:00', endTime: '2026-09-29T05:44:00-07:00' }),
    { side: 'right', start: 1790657460, end: 1790685840 });
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

test('vitals and movement default a missing range to the last day', () => {
  const now = 1790700000;
  assert.deepEqual(parseRowsQuery({}, now), { side: undefined, start: now - DEFAULT_ROWS_SECONDS, end: now });
  assert.deepEqual(parseRowsQuery({ side: 'left', startTime: '2026-09-29T00:00:00Z' }, now),
    { side: 'left', start: 1790640000, end: now });
  assert.deepEqual(parseRowsQuery({ endTime: '2026-09-29T00:00:00Z' }, now),
    { side: undefined, start: 1790640000 - DEFAULT_ROWS_SECONDS, end: 1790640000 });
});

test('vitals and movement keep a valid range as sent, reversed ones included', () => {
  const night = { side: 'right', startTime: '2026-09-28T21:51:00-07:00', endTime: '2026-09-29T05:44:00-07:00' };
  assert.deepEqual(parseRowsQuery(night, 0), { side: 'right', start: 1790657460, end: 1790685840 });
  const week = { startTime: '2026-09-22T05:44:00-07:00', endTime: '2026-09-29T05:44:00-07:00' };
  assert.deepEqual(parseRowsQuery(week, 0), { side: undefined, start: 1790685840 - 7 * 24 * 3600, end: 1790685840 });
  const longest = { startTime: '2026-10-28T00:00:00-07:00', endTime: '2026-11-04T00:00:00-08:00' };
  assert.deepEqual(parseRowsQuery(longest, 0), { side: undefined, start: 1793170800, end: 1793170800 + MAX_ROWS_SECONDS });
  const reversed = { startTime: '2026-09-29T05:44:00-07:00', endTime: '2026-09-28T21:51:00-07:00' };
  assert.deepEqual(parseRowsQuery(reversed, 0), { side: undefined, start: 1790685840, end: 1790657460 });
});

test('vitals and movement refuse malformed values and ranges over a week', () => {
  const now = 1790700000;
  for (const query of [
    { startTime: 'garbage' }, { side: 'middle' }, { startTime: ['0'] },
    { startTime: '2026-09-21T04:43:59-07:00', endTime: '2026-09-28T05:44:00-07:00' },
    { startTime: '2026-01-01T00:00:00Z' },
    { endTime: '9999-12-31T00:00:00Z', startTime: '2026-09-28T00:00:00Z' },
  ]) {
    assert.equal(parseRowsQuery(query, now), null, JSON.stringify(query));
  }
});
