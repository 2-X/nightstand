import { describe, it, expect } from 'vitest';
import { reconcileSelectedRecord } from './sleepSelection';
import { SleepRecord } from '../../../server/src/db/sleepRecordsSchema';

const record = (id: number, side: string): SleepRecord => ({
  id,
  side,
  entered_bed_at: `2026-09-0${id}T02:00:00Z`,
  left_bed_at: `2026-09-0${id}T08:00:00Z`,
  sleep_period_seconds: 21600,
  times_exited_bed: 0,
  present_intervals: [],
  not_present_intervals: [],
});

describe('reconcileSelectedRecord', () => {
  it('defaults to the most recent record when nothing is selected', () => {
    const records = [record(1, 'left'), record(2, 'left')];
    expect(reconcileSelectedRecord(undefined, records)?.id).toBe(2);
  });

  it('keeps the current selection across a refetch with fresh identities', () => {
    // The regression: after selecting night 1, a refetch returns equal
    // records with new object identities. The selection must survive by id
    // match, not snap back to the latest record.
    const selected = record(1, 'left');
    const refetched = [record(1, 'left'), record(2, 'left')];
    expect(reconcileSelectedRecord(selected, refetched)?.id).toBe(1);
  });

  it('falls back to the latest when the selection left the fetched set', () => {
    // Side switch or week change: the old selection is gone.
    const selected = record(1, 'left');
    const otherSide = [record(1, 'right'), record(2, 'right')];
    expect(reconcileSelectedRecord(selected, otherSide)?.id).toBe(2);
  });
});
