import { describe, expect, it } from 'vitest';
import { vitalsRecordsToPoints } from './vitalsPoints.ts';
import type { VitalsRecord } from '@api/vitals.ts';

const record = (overrides: Partial<VitalsRecord>): VitalsRecord => ({
  side: 'left',
  timestamp: 1751950800, // 2025-07-08T05:00:00Z
  heart_rate: 55,
  hrv: 60,
  breathing_rate: 12,
  ...overrides,
});

describe('vitalsRecordsToPoints', () => {
  it('treats record timestamps as epoch seconds, not milliseconds', () => {
    const [point] = vitalsRecordsToPoints([record({})], 'heart_rate');
    expect(point.timestamp.toISOString()).toBe('2025-07-08T05:00:00.000Z');
    expect(point.value).toBe(55);
  });

  it('preserves the spacing between samples', () => {
    const points = vitalsRecordsToPoints(
      [record({}), record({ timestamp: 1751950800 + 15 * 60 })],
      'heart_rate',
    );
    expect(points[1].timestamp.getTime() - points[0].timestamp.getTime()).toBe(15 * 60 * 1000);
  });

  it('drops records with non-positive or missing metric values', () => {
    const points = vitalsRecordsToPoints(
      [record({ heart_rate: 0 }), record({ heart_rate: NaN }), record({ heart_rate: 58 })],
      'heart_rate',
    );
    expect(points.map((p) => p.value)).toEqual([58]);
  });

  it('selects the requested metric', () => {
    const [point] = vitalsRecordsToPoints([record({})], 'breathing_rate');
    expect(point.value).toBe(12);
  });

  it('yields nothing when timestamps arrive as formatted strings', () => {
    // Not a supported input: this pins the shape of a past failure. The vitals
    // route used to reformat each epoch into an ISO8601 string before
    // responding, and because the filter below only keeps finite numbers,
    // every record was discarded and the chart rendered blank with no error
    // anywhere. The mocks returned numbers, so the whole suite stayed green.
    // If a transform like that comes back, this test says so directly.
    const stringly = [
      { ...record({}), timestamp: '2026-08-05T00:00:52-07:00' as unknown as number },
    ];
    expect(vitalsRecordsToPoints(stringly, 'heart_rate')).toEqual([]);
  });
});
