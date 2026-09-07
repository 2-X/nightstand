import { describe, it, expect } from 'vitest';
import { buildOverlayRows, OverlayPoint } from './overlaySeries';

const point = (ms: number, value: number): OverlayPoint => ({
  timestamp: new Date(ms),
  value,
});

describe('buildOverlayRows', () => {
  it('returns empty for no input', () => {
    expect(buildOverlayRows([], [])).toEqual([]);
  });

  it('merges left and right samples into shared rows', () => {
    // 10 buckets over [0, 10_000): bucket width 1000ms.
    const left = [point(0, 60), point(500, 62), point(9_000, 58)];
    const right = [point(1_100, 70), point(10_000, 72)];
    const rows = buildOverlayRows(left, right, 10);

    // Bucket 0: left mean (60+62)/2; right hasn't started yet (leading null).
    expect(rows[0].left).toBe(61);
    expect(rows[0].right).toBeNull();

    // Last bucket holds both sides' tail samples (right's 10_000 clamps into
    // the final bucket rather than creating an out-of-range index).
    const last = rows[rows.length - 1];
    expect(last.left).toBe(58);
    expect(last.right).toBe(72);
  });

  it('interpolates interior gaps within a side', () => {
    // Left has data in buckets 0 and 9; buckets 1-8 are linearly filled.
    const rows = buildOverlayRows([point(0, 10), point(9_500, 100)], [], 10);
    expect(rows).toHaveLength(10);
    expect(rows[0].left).toBe(10);
    expect(rows[1].left).toBe(20);
    expect(rows[5].left).toBe(60);
    expect(rows[9].left).toBe(100);
  });

  it('leaves leading and trailing gaps null instead of extrapolating', () => {
    // Right only exists in the middle of the window defined by left.
    const left = [point(0, 1), point(9_500, 1)];
    const right = [point(4_500, 50)];
    const rows = buildOverlayRows(left, right, 10);
    expect(rows[0].right).toBeNull();
    expect(rows[4].right).toBe(50);
    expect(rows[9].right).toBeNull();
  });

  it('averages multiple samples within one bucket', () => {
    const left = [point(0, 10), point(100, 20), point(200, 30)];
    const rows = buildOverlayRows(left, [], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(20);
  });

  it('handles a single-instant window without dividing by zero', () => {
    const rows = buildOverlayRows([point(5_000, 42)], [point(5_000, 43)], 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].left).toBe(42);
    expect(rows[0].right).toBe(43);
  });

  it('timestamps rows at bucket midpoints in chronological order', () => {
    const rows = buildOverlayRows(
      [point(0, 1), point(4_000, 2), point(8_000, 3)],
      [],
      4,
    );
    const times = rows.map((r) => r.timestamp.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
