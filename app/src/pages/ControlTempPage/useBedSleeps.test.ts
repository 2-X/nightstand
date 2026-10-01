import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import { bedSleepWindow, useBedSleeps } from './useBedSleeps';

type SleepsQuery = { data?: ResolvedSleepResponse[]; isError: boolean; refetch: () => void };
const fixture = vi.hoisted(() => ({
  state: 'active' as string,
  queries: {} as Record<string, SleepsQuery>,
  calls: [] as string[],
}));
vi.mock('@api/rhythms', () => ({
  useRhythmsState: () => ({ state: fixture.state, response: undefined, refetch: vi.fn() }),
  useResolvedSleeps: (side: string, from: string, to: string) => {
    const key = `${side} ${from} ${to}`;
    fixture.calls.push(key);
    return fixture.queries[key] ?? { data: undefined, isError: false, refetch: vi.fn() };
  },
}));

const sleep = { side: 'left', date: '2026-09-28' } as ResolvedSleepResponse;
const keyAt = (side: string, iso: string) => {
  const { from, to } = bedSleepWindow(Date.parse(iso));
  return `${side} ${from} ${to}`;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T19:59:00Z'));
  fixture.state = 'active';
  fixture.queries = { [keyAt('left', '2026-09-28T19:59:00Z')]: { data: [sleep], isError: false, refetch: vi.fn() } };
  fixture.calls = [];
});
afterEach(() => vi.useRealTimers());

it('asks for an hour-aligned window the server accepts, reaching past the longest pause', () => {
  const now = Date.parse('2026-09-28T19:42:10Z');
  const { from, to } = bedSleepWindow(now);
  expect(from).toBe('2026-09-28T01:00:00.000Z');
  expect(to).toBe('2026-10-12T20:00:00.000Z');
  expect(Date.parse(to) - now).toBeGreaterThanOrEqual(14 * 24 * 60 * 60 * 1000);
  expect(Date.parse(to) - Date.parse(from)).toBeLessThanOrEqual(16 * 24 * 60 * 60 * 1000);
});

it('keeps the last sleeps while the next hour\'s window loads', () => {
  const { result, rerender } = renderHook(({ side }) => useBedSleeps(side), { initialProps: { side: 'left' as const } });
  expect(result.current).toMatchObject({ state: 'rhythms', sleeps: [sleep] });
  vi.setSystemTime(new Date('2026-09-28T20:00:30Z'));
  rerender({ side: 'left' });
  expect(fixture.calls[fixture.calls.length - 1]).toBe(keyAt('left', '2026-09-28T20:00:30Z'));
  expect(result.current).toMatchObject({ state: 'rhythms', sleeps: [sleep] });
});

it('keeps the last sleeps when the next hour\'s window fails to load', () => {
  const { result, rerender } = renderHook(() => useBedSleeps('left'));
  vi.setSystemTime(new Date('2026-09-28T20:00:30Z'));
  fixture.queries[keyAt('left', '2026-09-28T20:00:30Z')] = { data: undefined, isError: true, refetch: vi.fn() };
  rerender();
  expect(result.current).toMatchObject({ state: 'rhythms', sleeps: [sleep] });
});

it('never shows one side\'s sleeps for the other', () => {
  const { result, rerender } = renderHook(({ side }) => useBedSleeps(side), { initialProps: { side: 'left' as 'left' | 'right' } });
  rerender({ side: 'right' });
  expect(result.current).toEqual({ state: 'loading' });
});

it('says the schedule is unavailable when sleeps never loaded', () => {
  fixture.queries = { [keyAt('left', '2026-09-28T19:59:00Z')]: { data: undefined, isError: true, refetch: vi.fn() } };
  const { result } = renderHook(() => useBedSleeps('left'));
  expect(result.current.state).toBe('error');
});

it('reads the weekly schedule while Rhythms is off', () => {
  fixture.state = 'off';
  const { result } = renderHook(() => useBedSleeps('left'));
  expect(result.current).toEqual({ state: 'legacy' });
});
