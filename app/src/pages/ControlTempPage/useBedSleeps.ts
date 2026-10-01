import { useRef } from 'react';
import { useResolvedSleeps, useRhythmsState } from '@api/rhythms';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import type { Side } from '@state/appStore';
import { MAX_PAUSE_DAYS } from './pauseTimes';

export type BedSleeps =
  | { state: 'legacy' }
  | { state: 'loading' }
  | { state: 'error'; retry: () => void }
  | { state: 'rhythms'; sleeps: ResolvedSleepResponse[]; names?: Record<string, string> };

const HOUR_MS = 60 * 60 * 1000;

// Hour-aligned so the query key, and the request, change at most once an hour.
// It reaches past the longest pause, so the pause sheet can list what it skips.
export function bedSleepWindow(now = Date.now()) {
  const hour = Math.floor(now / HOUR_MS);
  return {
    from: new Date((hour - 18) * HOUR_MS).toISOString(),
    to: new Date((hour + 1 + 24 * MAX_PAUSE_DAYS) * HOUR_MS).toISOString(),
  };
}

export function useBedSleeps(side: Side): BedSleeps {
  const rhythmsState = useRhythmsState();
  const { from, to } = bedSleepWindow();
  const sleeps = useResolvedSleeps(side, from, to, rhythmsState.state === 'active');
  // The window moves every hour; until the new one loads, or if it fails, the last one stands in.
  const last = useRef<{ side: Side; data: ResolvedSleepResponse[] }>(undefined);
  if (rhythmsState.state === 'off' || rhythmsState.state === 'inactive') {
    last.current = undefined;
    return { state: 'legacy' };
  }
  if (sleeps.data) last.current = { side, data: sleeps.data };
  const data = sleeps.data ?? (last.current?.side === side ? last.current.data : undefined);
  if (rhythmsState.state === 'error') return { state: 'error', retry: () => void rhythmsState.refetch() };
  if (rhythmsState.state === 'active' && sleeps.isError && !data) return { state: 'error', retry: () => void sleeps.refetch() };
  if (rhythmsState.state !== 'active' || !data) return { state: 'loading' };
  const rhythms = rhythmsState.response?.data?.[side].rhythms ?? {};
  const names = Object.fromEntries(Object.values(rhythms).map(rhythm => [rhythm.id, rhythm.name]));
  return { state: 'rhythms', sleeps: data, names };
}
