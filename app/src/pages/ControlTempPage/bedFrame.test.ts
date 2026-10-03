import { expect, it } from 'vitest';
import { REFRESH_GRACE_MS, STALE_AFTER_MS, bedFrame } from './bedFrame';

// Monday 9:41 PM in Los Angeles.
const T = Date.parse('2026-09-29T04:41:00Z');
const status = { isOn: true, targetTemperatureF: 84, currentTemperatureF: 82 };
const base = {
  status, hasData: true, isError: false, failureCount: 0, dataUpdatedAt: T, requestedAt: T - 1_000, now: T,
};

it('waits two minutes', () => {
  expect(STALE_AFTER_MS).toBe(120_000);
});

it('is loading until the first answer', () => {
  expect(bedFrame({ ...base, status: undefined, hasData: false, dataUpdatedAt: 0, refreshStartedAt: T })).toEqual({ kind: 'loading' });
});

it('is live up to two minutes after the last status', () => {
  expect(bedFrame(base)).toEqual({ kind: 'live', status });
  expect(bedFrame({ ...base, now: T + STALE_AFTER_MS })).toEqual({ kind: 'live', status });
});

it('shows nothing past two minutes until a refresh answers, rather than an old value or a failure', () => {
  expect(bedFrame({ ...base, now: T + STALE_AFTER_MS + 1 })).toEqual({ kind: 'loading' });
  // An app opened again after eight minutes away, its refresh just started.
  expect(bedFrame({ ...base, now: T + 480_000, refreshStartedAt: T + 480_000 })).toEqual({ kind: 'loading' });
});

it('turns stale at once when a refresh fails, whatever its age', () => {
  expect(bedFrame({ ...base, isError: true, now: T + 5_000 })).toEqual({ kind: 'stale', since: new Date(T), status });
});

it('turns stale, keeping the last values and their time, once a refresh fails or goes unanswered for five seconds', () => {
  expect(REFRESH_GRACE_MS).toBe(5_000);
  const now = T + 480_000;
  expect(bedFrame({ ...base, now, refreshStartedAt: now - REFRESH_GRACE_MS })).toEqual({ kind: 'loading' });
  expect(bedFrame({ ...base, now, refreshStartedAt: now - REFRESH_GRACE_MS - 1 })).toEqual({ kind: 'stale', since: new Date(T), status });
  expect(bedFrame({ ...base, now, refreshStartedAt: now - 1_000, failureCount: 1 })).toEqual({ kind: 'stale', since: new Date(T), status });
});

it('dates a first load that failed from when the page first asked', () => {
  expect(bedFrame({ ...base, status: undefined, hasData: false, isError: true, dataUpdatedAt: 0 }))
    .toEqual({ kind: 'stale', since: new Date(T - 1_000) });
});

it('treats a status without the selected side as no answer', () => {
  expect(bedFrame({ ...base, status: undefined })).toEqual({ kind: 'stale', since: new Date(T - 1_000) });
});
