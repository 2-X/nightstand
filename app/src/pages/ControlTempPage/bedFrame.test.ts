import { expect, it } from 'vitest';
import { STALE_AFTER_MS, bedFrame } from './bedFrame';

// Monday 9:41 PM in Los Angeles.
const T = Date.parse('2026-09-29T04:41:00Z');
const status = { isOn: true, targetTemperatureF: 84, currentTemperatureF: 82 };
const base = {
  status, hasData: true, isError: false, isFetching: false, failureCount: 0, dataUpdatedAt: T, requestedAt: T - 1_000, now: T,
};

it('waits two minutes', () => {
  expect(STALE_AFTER_MS).toBe(120_000);
});

it('is loading until the first answer', () => {
  expect(bedFrame({ ...base, status: undefined, hasData: false, dataUpdatedAt: 0, isFetching: true })).toEqual({ kind: 'loading' });
});

it('is live up to two minutes after the last status', () => {
  expect(bedFrame(base)).toEqual({ kind: 'live', status });
  expect(bedFrame({ ...base, now: T + STALE_AFTER_MS })).toEqual({ kind: 'live', status });
});

it('turns stale just past two minutes, keeping the last values and their time', () => {
  expect(bedFrame({ ...base, now: T + STALE_AFTER_MS + 1 })).toEqual({ kind: 'stale', since: new Date(T), status });
});

it('turns stale at once when a refresh fails, whatever its age', () => {
  expect(bedFrame({ ...base, isError: true, now: T + 5_000 })).toEqual({ kind: 'stale', since: new Date(T), status });
});

it('waits for a refresh under way before calling an old status stale, until one attempt fails', () => {
  expect(bedFrame({ ...base, isFetching: true, now: T + 600_000 })).toEqual({ kind: 'live', status });
  expect(bedFrame({ ...base, isFetching: true, failureCount: 1, now: T + 600_000 }))
    .toEqual({ kind: 'stale', since: new Date(T), status });
});

it('dates a first load that failed from when the page first asked', () => {
  expect(bedFrame({ ...base, status: undefined, hasData: false, isError: true, dataUpdatedAt: 0 }))
    .toEqual({ kind: 'stale', since: new Date(T - 1_000) });
});

it('treats a status without the selected side as no answer', () => {
  expect(bedFrame({ ...base, status: undefined })).toEqual({ kind: 'stale', since: new Date(T - 1_000) });
});
