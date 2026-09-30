import moment from 'moment-timezone';

export interface MetricsQuery {
  side?: 'left' | 'right';
  start?: number;
  end?: number;
}

const unixTime = (value: unknown): number | undefined | null => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const time = moment(value, moment.ISO_8601, true);
  return time.isValid() ? time.unix() : null;
};

// Returns null when a value would reach the database query as NaN, an array or an unknown side.
export function parseMetricsQuery(query: Record<string, unknown>): MetricsQuery | null {
  const { side, startTime, endTime } = query;
  if (side !== undefined && side !== '' && side !== 'left' && side !== 'right') return null;
  const start = unixTime(startTime);
  const end = unixTime(endTime);
  if (start === null || end === null) return null;
  return { side: side || undefined, start, end } as MetricsQuery;
}

export interface NightQuery {
  side: 'left' | 'right';
  start: number;
  end: number;
}

// Stages and scores build one entry per five minutes of the range, so an
// unbounded range could exhaust the Pod's memory.
export const MAX_NIGHT_SECONDS = 48 * 3600;

export function parseNightQuery(query: Record<string, unknown>): NightQuery | null {
  const range = parseMetricsQuery(query);
  if (!range?.side || range.start === undefined || range.end === undefined) return null;
  if (range.end <= range.start || range.end - range.start > MAX_NIGHT_SECONDS) return null;
  return { side: range.side, start: range.start, end: range.end };
}
