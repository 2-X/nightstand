import { getDeviceStatus } from '../mocks/mockData';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import axios from './api';
import { server } from '@test/setup';
import { useUpdateProgress, migrationsApplied } from './useUpdateProgress';

// An install is judged done when the pod reports a different version. A
// reinstall of the running version never does, so it needs its own test of
// done, or a successful reinstall would sit for ten minutes and then report
// that it may have rolled back.

const originalLocation = window.location;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

const deviceVersion = (version: string) =>
  server.use(http.get('*/deviceStatus',
    () => HttpResponse.json({ ...getDeviceStatus(),
      freeSleep: { ...getDeviceStatus().freeSleep,
        version } })));

const unapplied = (names: string[]) =>
  server.use(http.get('*/serverStatus', () => HttpResponse.json({
    database: {
      name: 'Database',
      status: names.length ? 'failed' : 'healthy',
      description: '',
      message: '',
      unappliedMigrations: names.length ? names : undefined,
    },
  })));

async function startAndPoll(hook: { current: ReturnType<typeof useUpdateProgress> }) {
  await act(async () => { await hook.current.start(async () => undefined); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
}

describe('useUpdateProgress', () => {
  it('reloads once the pod reports a different version', async () => {
    deviceVersion('3.2.1');
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    await startAndPoll(result);
    expect(reload).toHaveBeenCalled();
  });

  it('keeps waiting while the pod still reports the version it started on', async () => {
    deviceVersion('3.2.0');
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    await startAndPoll(result);
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('updating');
  });

  it('uses the caller\'s test of done instead of the version when given one', async () => {
    // A reinstall: same version throughout, done when the database is.
    deviceVersion('3.2.0');
    unapplied([]);
    const { result } = renderHook(() => useUpdateProgress('3.2.0', migrationsApplied));
    await startAndPoll(result);
    expect(reload).toHaveBeenCalled();
  });

  it('does not finish a reinstall while migrations are still unapplied', async () => {
    unapplied(['20260825052500_calibration_run_payload']);
    const { result } = renderHook(() => useUpdateProgress('3.2.0', migrationsApplied));
    await startAndPoll(result);
    expect(reload).not.toHaveBeenCalled();
  });

  it('times out rather than polling forever', async () => {
    unapplied(['20260825052500_calibration_run_payload']);
    const { result } = renderHook(() => useUpdateProgress('3.2.0', migrationsApplied));
    await act(async () => { await result.current.start(async () => undefined); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 10_000); });
    expect(result.current.phase).toBe('timed_out');
    expect(reload).not.toHaveBeenCalled();
  });
});

for (const status of [400, 500]) {
  it(`surfaces HTTP ${status} as a dismissible failure without polling`, async () => {
    server.use(http.post('*/update', () => HttpResponse.json({ error: 'Update refused' }, { status })));
    deviceVersion('3.2.1');
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    await act(async () => { await result.current.start(() => axios.post('/update', {})); });
    expect(result.current.phase).toBe('failed');
    expect(result.current.recordedOutcome).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(reload).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
  });
}
it('keeps polling after an ambiguous transport disconnect', async () => {
  server.use(http.post('*/update', () => HttpResponse.error()));
  deviceVersion('3.2.0');
  const { result } = renderHook(() => useUpdateProgress('3.2.0'));
  await act(async () => { await result.current.start(() => axios.post('/update', {})); });
  expect(result.current.phase).toBe('updating');
});

describe('when the bed may be in use', () => {
  const refuse = (reasons: unknown) => HttpResponse.json({ error: 'in use', message: 'in use', reasons }, { status: 409 });

  it('stays idle with the reasons, then confirms on the next start', async () => {
    const confirms: boolean[] = [];
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    server.use(http.post('*/update', () => refuse(['right-on'])));
    await act(async () => { await result.current.start(confirm => { confirms.push(confirm); return axios.post('/update', {}); }); });
    expect(result.current.phase).toBe('idle');
    expect(result.current.inUse).toEqual(['right-on']);
    server.use(http.post('*/update', () => new HttpResponse(null, { status: 204 })));
    await act(async () => { await result.current.start(confirm => { confirms.push(confirm); return axios.post('/update', {}); }); });
    expect(confirms).toEqual([false, true]);
    expect(result.current.phase).toBe('updating');
  });

  it('forgets the reasons on reset', async () => {
    server.use(http.post('*/update', () => refuse(['left-on'])));
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    await act(async () => { await result.current.start(() => axios.post('/update', {})); });
    act(() => result.current.reset());
    expect(result.current.inUse).toBeUndefined();
  });

  it.each([
    ['no reasons', undefined],
    ['an empty list', []],
    ['reasons it does not know', ['from-the-future']],
  ])('treats a 409 with %s as a plain failure', async (_what, reasons) => {
    server.use(http.post('*/update', () => refuse(reasons)));
    const { result } = renderHook(() => useUpdateProgress('3.2.0'));
    await act(async () => { await result.current.start(() => axios.post('/update', {})); });
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe('in use');
    expect(result.current.inUse).toBeUndefined();
  });
});

describe('when the update, rollback or switch records how it ended', () => {
  const REASON = 'low disk on /persistent (310M free, 420M needed)';
  const STOPPED_BEFORE_CHANGES = `The update stopped before changing anything: ${REASON}`;
  const ROLLED_BACK_MESSAGE = `The update did not pass its checks, so Nightstand went back to v3.5.1: ${REASON}`;
  const NO_ROLLBACK_MESSAGE = 'The update failed and Nightstand could not go back on its own. '
    + 'Open the update log and System status before trying again.';
  const record = (runId: string, outcome: string, operation = 'update') =>
    ({ runId, operation, outcome, from: '3.5.1', to: '3.6.0', message: REASON, finishedAt: '2026-10-02T03:04:05Z' });

  // The first read is the one taken when the action starts; later ones are polls.
  const results = (...answers: (object | number)[]) => {
    let calls = 0;
    server.use(http.get('*/update/last-result', () => {
      const answer = answers[Math.min(calls++, answers.length - 1)];
      return typeof answer === 'number'
        ? HttpResponse.json({ error: 'none' }, { status: answer })
        : HttpResponse.json(answer);
    }));
  };

  it.each([
    ['stopped', STOPPED_BEFORE_CHANGES],
    ['up-to-date', STOPPED_BEFORE_CHANGES],
    ['rolled-back', ROLLED_BACK_MESSAGE],
    ['failed', NO_ROLLBACK_MESSAGE],
  ])('ends the wait at once on a %s result', async (outcome, text) => {
    deviceVersion('3.5.1');
    results(record('old', 'success'), record('new', outcome));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toBe(text);
    expect(result.current.recordedOutcome).toBe(outcome);
    expect(reload).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.recordedOutcome).toBeUndefined();
  });

  it('treats a first result as new when none was recorded before', async () => {
    deviceVersion('3.5.1');
    results(404, record('first', 'stopped'));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.error).toBe(STOPPED_BEFORE_CHANGES);
  });

  it('ignores the result of an earlier run', async () => {
    deviceVersion('3.5.1');
    results(record('same', 'failed'));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('keeps waiting on a success, and reloads once the version moves', async () => {
    deviceVersion('3.5.1');
    results(record('old', 'failed'), record('new', 'success'));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
    deviceVersion('3.6.0');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(reload).toHaveBeenCalled();
  });

  it('does not end the wait when the first read failed, since an old result could look new', async () => {
    deviceVersion('3.5.1');
    results(500, record('old', 'failed'));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('keeps waiting through a poll that cannot reach the server', async () => {
    deviceVersion('3.5.1');
    results(record('old', 'success'), 503);
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('keeps waiting on a result it cannot read', async () => {
    deviceVersion('3.5.1');
    results(record('old', 'success'), { runId: 'new', outcome: 'exploded' });
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('shows no version when a rolled-back result has none', async () => {
    deviceVersion('3.5.1');
    results(404, { ...record('new', 'rolled-back'), from: null });
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  const failedRollback = 'The rollback failed and Nightstand could not return to v3.5.1 on its own. '
    + 'Open the rollback log and System status before trying again.';
  const worded: ['rollback' | 'switch', string, string | null][] = [
    ['rollback', 'stopped', `The rollback stopped before changing anything: ${REASON}`],
    ['rollback', 'rolled-back', `v3.6.0 did not pass its checks, so Nightstand stayed on v3.5.1: ${REASON}`],
    ['rollback', 'failed', failedRollback],
    ['rollback', 'up-to-date', null],
    ['switch', 'stopped', `The switch to upstream free-sleep stopped before changing anything: ${REASON}`],
    ['switch', 'rolled-back', `Upstream free-sleep did not pass its checks, so Nightstand went back to v3.5.1: ${REASON}`],
    ['switch', 'failed', 'The switch failed and Nightstand could not go back on its own. '
      + 'Open the switch log and System status before trying again.'],
    ['switch', 'up-to-date', null],
  ];
  for (const [operation, outcome, text] of worded) {
    it(`words a ${outcome} ${operation}${text ? '' : ' as nothing to show'}`, async () => {
      deviceVersion('3.5.1');
      results(record('old', 'success', operation), record('new', outcome, operation));
      const { result } = renderHook(() => useUpdateProgress('3.5.1', undefined, operation));
      await startAndPoll(result);
      if (text === null) {
        expect(result.current.phase).toBe('updating');
      } else {
        expect(result.current.phase).toBe('failed');
        expect(result.current.error).toBe(text);
      }
    });
  }

  it.each([
    ['rollback', 'rolled-back', { from: null }],
    ['rollback', 'rolled-back', { to: null }],
    ['rollback', 'failed', { from: null }],
    ['switch', 'rolled-back', { from: null }],
  ] as const)('keeps waiting on a %s %s that lacks a version it would name', async (operation, outcome, missing) => {
    deviceVersion('3.5.1');
    results(record('old', 'success', operation), { ...record('new', outcome, operation), ...missing });
    const { result } = renderHook(() => useUpdateProgress('3.5.1', undefined, operation));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('ignores a record of a different operation than the one started', async () => {
    deviceVersion('3.5.1');
    results(record('old', 'success'), record('new', 'failed', 'rollback'));
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });

  it('ignores a record that finished before the one seen at the start', async () => {
    deviceVersion('3.5.1');
    results({ ...record('late', 'success'), finishedAt: '2026-10-02T04:00:00Z' },
      { ...record('stale', 'failed'), finishedAt: '2026-10-02T03:00:00Z' });
    const { result } = renderHook(() => useUpdateProgress('3.5.1'));
    await startAndPoll(result);
    expect(result.current.phase).toBe('updating');
  });
});
