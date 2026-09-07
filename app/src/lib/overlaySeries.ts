export type OverlayPoint = { timestamp: Date; value: number };

/** One resampled row shared by both sides; null = no data in that bucket. */
export type OverlayRow = { timestamp: Date; left: number | null; right: number | null };

// Fill interior null runs in place with linear interpolation between the
// surrounding known values. Runs before the first or after the last known
// value are left as null.
function interpolateGaps(values: (number | null)[]): void {
  let previousKnown = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] == null) continue;
    if (previousKnown >= 0 && index - previousKnown > 1) {
      const startValue = values[previousKnown] as number;
      const endValue = values[index] as number;
      const gapLength = index - previousKnown;
      for (let gap = previousKnown + 1; gap < index; gap += 1) {
        values[gap] = startValue + ((endValue - startValue) * (gap - previousKnown)) / gapLength;
      }
    }
    previousKnown = index;
  }
}

/**
 * Resample two independently-timestamped series onto a shared time axis so
 * they can be drawn as overlaid lines on one chart.
 *
 * MUI x-charts' dataset-based LineChart wants one row per x value with a
 * column per series, but the left and right sides of the bed record vitals at
 * their own timestamps. This splits the combined time window into up to
 * `maxBuckets` equal buckets, takes the per-bucket mean for each side, and
 * linearly interpolates interior gaps so both columns are dense over each
 * side's span (see the comment in the body for why nulls + connectNulls is
 * not enough). Averaging within buckets also smooths sensor jitter, same
 * rationale as VitalsLineChart's bucketAggregate.
 */
export function buildOverlayRows(
  left: OverlayPoint[],
  right: OverlayPoint[],
  maxBuckets = 60,
): OverlayRow[] {
  const allTimes = [...left, ...right].map((p) => p.timestamp.getTime());
  if (allTimes.length === 0) return [];

  const startMs = Math.min(...allTimes);
  const endMs = Math.max(...allTimes);
  // Single-instant window: emit one merged row rather than dividing by zero.
  const spanMs = Math.max(endMs - startMs, 1);
  const bucketMs = spanMs / maxBuckets;

  type Accumulator = { sum: number; count: number };
  const accumulate = (points: OverlayPoint[]): Map<number, Accumulator> => {
    const buckets = new Map<number, Accumulator>();
    for (const point of points) {
      const index = Math.min(
        Math.floor((point.timestamp.getTime() - startMs) / bucketMs),
        maxBuckets - 1,
      );
      const bucket = buckets.get(index) ?? { sum: 0, count: 0 };
      bucket.sum += point.value;
      bucket.count += 1;
      buckets.set(index, bucket);
    }
    return buckets;
  };

  // Per-bucket means, then linear interpolation across interior gaps. The
  // two sides sample at their own cadence, so their filled buckets interleave;
  // leaving the gaps as nulls and relying on the chart's connectNulls
  // mis-renders in MUI x-charts v7 (the line collapses to a fraction of the
  // axis). Interpolating draws exactly what connectNulls would have - a
  // straight segment across the gap - while keeping every row dense.
  // Leading/trailing buckets outside a side's data stay null so a side that
  // came to bed later simply starts later.
  const meansFor = (points: OverlayPoint[]): (number | null)[] => {
    const buckets = accumulate(points);
    const means: (number | null)[] = new Array(maxBuckets).fill(null);
    for (const [index, bucket] of buckets) means[index] = bucket.sum / bucket.count;
    interpolateGaps(means);
    return means;
  };

  const leftMeans = meansFor(left);
  const rightMeans = meansFor(right);

  const rows: OverlayRow[] = [];
  for (let index = 0; index < maxBuckets; index += 1) {
    if (leftMeans[index] == null && rightMeans[index] == null) continue;
    rows.push({
      timestamp: new Date(startMs + (index + 0.5) * bucketMs),
      left: leftMeans[index],
      right: rightMeans[index],
    });
  }
  return rows;
}
