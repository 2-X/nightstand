import { describe, expect, it } from 'vitest';
import { HRV_RANGE, splitAtGaps, vitalsRecordsToPoints } from './vitalsPoints.ts';
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

  it('keeps HRV readings inside the range the sleep score uses', () => {
    expect(HRV_RANGE).toEqual([30, 120]);
    const points = vitalsRecordsToPoints(
      [29, 30, 65, 120, 121, 250].map(hrv => record({ hrv })),
      'hrv',
    );
    expect(points.map(point => point.value)).toEqual([30, 65, 120]);
  });

  it('does not limit heart rate to the HRV range', () => {
    const points = vitalsRecordsToPoints([record({ heart_rate: 20 }), record({ heart_rate: 140 })], 'heart_rate');
    expect(points.map(point => point.value)).toEqual([20, 140]);
  });

  it('reads the newer metrics and skips minutes without them', () => {
    const points = vitalsRecordsToPoints(
      [record({ rmssd: 40, resp_rate: 15.5 }), record({ rmssd: null, resp_rate: null }), record({})],
      'resp_rate',
    );
    expect(points.map((p) => p.value)).toEqual([15.5]);
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

describe('splitAtGaps', () => {
  const at = (seconds: number) => ({ timestamp: new Date(Date.UTC(2026, 8, 28) + seconds * 1000), value: 60 });
  const minutes = (...offsets: number[]) => offsets.map(offset => at(offset * 60));
  const offsets = (runs: { timestamp: Date }[][]) =>
    runs.map(run => run.map(point => (point.timestamp.getTime() - Date.UTC(2026, 8, 28)) / 60_000));

  it('breaks wherever a one-minute row is missing', () => {
    expect(offsets(splitAtGaps(minutes(0, 1, 31)))).toEqual([[0, 1], [31]]);
    expect(offsets(splitAtGaps(minutes(0, 1, 3, 4)))).toEqual([[0, 1], [3, 4]]);
  });

  it('keeps rows a few seconds off the minute together', () => {
    expect(splitAtGaps([at(0), at(62), at(119), at(181)])).toHaveLength(1);
  });

  it('keeps the older writer\'s rows, 40 to 80 seconds apart, together', () => {
    expect(splitAtGaps([at(0), at(40), at(120), at(165), at(245), at(285), at(360)])).toHaveLength(1);
    expect(splitAtGaps([at(0), at(80), at(160), at(240)])).toHaveLength(1);
  });

  it('breaks at the two minutes one missing row leaves, and keeps up to 115 seconds joined', () => {
    expect(splitAtGaps([at(0), at(115)])).toHaveLength(1);
    expect(splitAtGaps([at(0), at(116)])).toHaveLength(2);
  });

  it('orders the rows by time first', () => {
    expect(offsets(splitAtGaps(minutes(4, 1, 0, 3)))).toEqual([[0, 1], [3, 4]]);
  });

  it('returns nothing for no readings', () => {
    expect(splitAtGaps([])).toEqual([]);
  });
});
