import { useEffect, useRef, useState } from 'react';
import axios from './api';
import { isAxiosError } from 'axios';
import { inUseReasons, type InUseReasonText } from './bedInUse';

export type UpdatePhase = 'idle' | 'updating' | 'timed_out' | 'failed';

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

async function versionMovedOff(startVersion: string | undefined) {
  const { data } = await axios.get('/deviceStatus', { timeout: 4_000 });
  return !!data?.freeSleep?.version && data.freeSleep.version !== startVersion;
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
// A 409 saying the bed may be in use sends the phase back to 'idle' with the
// reasons in inUse. The next start tells the action to confirm, so the
// confirmation is only ever sent after the user has seen why.
export function useUpdateProgress(runningVersion: string | undefined, isComplete?: () => Promise<boolean>) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [error, setError] = useState<string>();
  const [inUse, setInUse] = useState<InUseReasonText[]>();
  // Captured when the action starts, so a mid-action refresh of deviceStatus
  // elsewhere in the app can't move the goalposts the poller compares against.
  const startVersionRef = useRef(runningVersion);
  const isCompleteRef = useRef(isComplete);
  isCompleteRef.current = isComplete;

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
        const done = isCompleteRef.current
          ? await isCompleteRef.current()
          : await versionMovedOff(startVersionRef.current);
        if (done && !cancelled) window.location.reload();
      } catch {
        // expected while the service restarts mid-action
      }
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(poll); };
  }, [phase]);

  const start = async (action: (confirmInUse: boolean) => Promise<unknown>) => {
    const confirmInUse = (inUse?.length ?? 0) > 0;
    startVersionRef.current = runningVersion;
    setError(undefined);
    setPhase('updating');
    try {
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

  const reset = () => { setError(undefined); setInUse(undefined); setPhase('idle'); };

  return { phase, error, inUse, start, reset };
}
