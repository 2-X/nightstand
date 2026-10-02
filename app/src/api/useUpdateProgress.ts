import { useEffect, useRef, useState } from 'react';
import axios from './api';
import { isAxiosError } from 'axios';
import { inUseReasons, type InUseReasonText } from './bedInUse';
import { UpdateResultSchema, type UpdateResult } from './updateSchema';

export type UpdatePhase = 'idle' | 'updating' | 'timed_out' | 'failed';

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

async function versionMovedOff(startVersion: string | undefined) {
  const { data } = await axios.get('/deviceStatus', { timeout: 4_000 });
  return !!data?.freeSleep?.version && data.freeSleep.version !== startVersion;
}

// The record the update, rollback and switch scripts leave when they end. A
// 404 or an unreadable record means none; any other failure is thrown, since
// it says nothing about what was recorded.
async function lastResult(): Promise<UpdateResult | null> {
  try {
    const { data } = await axios.get('/update/last-result', { timeout: 4_000 });
    const parsed = UpdateResultSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

// What a record that ended the wait says, worded for the operation. A version
// the sentence names must have been recorded; otherwise there is nothing true
// to say and the wait goes on.
function resultMessage(result: UpdateResult): string | null {
  const { operation, outcome, from, to, message } = result;
  if (operation === 'update') {
    if (outcome === 'stopped' || outcome === 'up-to-date') return `The update stopped before changing anything: ${message}`;
    if (outcome === 'rolled-back') {
      return from ? `The update did not pass its checks, so Nightstand went back to v${from}: ${message}` : null;
    }
    if (outcome === 'failed') {
      return 'The update failed and Nightstand could not go back on its own. Open the update log and System status before trying again.';
    }
  } else if (operation === 'rollback') {
    if (outcome === 'stopped') return `The rollback stopped before changing anything: ${message}`;
    if (outcome === 'rolled-back') {
      return from && to ? `v${to} did not pass its checks, so Nightstand stayed on v${from}: ${message}` : null;
    }
    if (outcome === 'failed') {
      return from
        ? `The rollback failed and Nightstand could not return to v${from} on its own. `
          + 'Open the rollback log and System status before trying again.'
        : null;
    }
  } else {
    if (outcome === 'stopped') return `The switch to upstream free-sleep stopped before changing anything: ${message}`;
    if (outcome === 'rolled-back') {
      return from ? `Upstream free-sleep did not pass its checks, so Nightstand went back to v${from}: ${message}` : null;
    }
    if (outcome === 'failed') {
      return 'The switch failed and Nightstand could not go back on its own. Open the switch log and System status before trying again.';
    }
  }
  return null;
}

// Done once the database reports nothing left to apply, for a reinstall run
// to finish migrations an earlier update left behind.
export async function migrationsApplied() {
  const { data } = await axios.get('/serverStatus', { timeout: 4_000 });
  return !!data?.database && !data.database.unappliedMigrations?.length;
}

// Shared by every action that ends in the pod swapping to a different
// running version: fire the action, then poll /api/deviceStatus until the
// reported version moves off what was running when the action started, and
// reload the page to pick up the new bundle. A version that never changes
// within the timeout surfaces as 'timed_out' instead of polling forever.
//
// A reinstall of the running version never moves the version, so it passes
// its own isComplete instead.
//
// A record that ended with a refusal, a rollback or a failure ends the wait at
// once instead of leaving it to the timeout. Only a record with a different
// run id from the one seen when the action started counts, and only one for
// the operation that was started and no older than that one; if the first
// read failed there is nothing to compare with, so the wait runs as it always
// did.
//
// A 409 saying the bed may be in use sends the phase back to 'idle' with the
// reasons in inUse. The next start tells the action to confirm, so the
// confirmation is only ever sent after the user has seen why.
export function useUpdateProgress(
  runningVersion: string | undefined,
  isComplete?: () => Promise<boolean>,
  operation: UpdateResult['operation'] = 'update',
) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [error, setError] = useState<string>();
  const [inUse, setInUse] = useState<InUseReasonText[]>();
  // Set when a failure came from the record the scripts left, so the action
  // was accepted and ran, rather than from a refused request.
  const [recordedOutcome, setRecordedOutcome] = useState<UpdateResult['outcome']>();
  // Captured when the action starts, so a mid-action refresh of deviceStatus
  // elsewhere in the app can't move the goalposts the poller compares against.
  const startVersionRef = useRef(runningVersion);
  const isCompleteRef = useRef(isComplete);
  isCompleteRef.current = isComplete;
  // undefined until the read at the start answers; null when nothing was recorded.
  const baseline = useRef<{ runId: string; finishedAt: string } | null | undefined>(undefined);

  useEffect(() => {
    if (phase !== 'updating') return;
    const startedAt = Date.now();
    let cancelled = false;
    const poll = setInterval(async () => {
      if (Date.now() - startedAt > UPDATE_TIMEOUT_MS) {
        setPhase('timed_out');
        return;
      }
      try {
        const result = baseline.current === undefined ? null : await lastResult().catch(() => null);
        const isNew = !!result && result.operation === operation && result.runId !== baseline.current?.runId
          && !(baseline.current && result.finishedAt < baseline.current.finishedAt);
        const message = result && isNew ? resultMessage(result) : null;
        if (result && message) {
          if (!cancelled) { setError(message); setRecordedOutcome(result.outcome); setPhase('failed'); }
          return;
        }
        const done = isCompleteRef.current
          ? await isCompleteRef.current()
          : await versionMovedOff(startVersionRef.current);
        if (done && !cancelled) window.location.reload();
      } catch {
        // expected while the service restarts mid-action
      }
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(poll); };
  }, [phase, operation]);

  const start = async (action: (confirmInUse: boolean) => Promise<unknown>) => {
    const confirmInUse = (inUse?.length ?? 0) > 0;
    startVersionRef.current = runningVersion;
    setError(undefined);
    setRecordedOutcome(undefined);
    baseline.current = undefined;
    setPhase('updating');
    try {
      baseline.current = await lastResult().then(result => result && { runId: result.runId, finishedAt: result.finishedAt }, () => undefined);
      await action(confirmInUse);
    } catch (failure) {
      const reasons = inUseReasons(failure);
      if (reasons) {
        setInUse(reasons);
        setPhase('idle');
        return;
      }
      // A response is a definitive rejection; a lost connection can mean the
      // service already restarted, so only that ambiguous case keeps polling.
      if (isAxiosError(failure) && !failure.response) return;
      const data = isAxiosError(failure) ? failure.response?.data : undefined;
      const detail = data?.error ?? data?.message;
      setInUse(undefined);
      setError(typeof detail === 'string' ? detail : 'Unable to start this operation. Please try again.');
      setPhase('failed');
    }
  };

  const reset = () => { setError(undefined); setInUse(undefined); setRecordedOutcome(undefined); setPhase('idle'); };

  return { phase, error, inUse, recordedOutcome, start, reset };
}
