import { useEffect, useRef, useState } from 'react';
import axios from './api';

export type UpdatePhase = 'idle' | 'updating' | 'timed_out';

const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

// Shared by every action that ends in the pod swapping to a different
// running version: fire the action, then poll /api/deviceStatus until the
// reported version moves off what was running when the action started, and
// reload the page to pick up the new bundle. A version that never changes
// within the timeout surfaces as 'timed_out' instead of polling forever.
export function useUpdateProgress(runningVersion: string | undefined) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  // Captured when the action starts, so a mid-action refresh of deviceStatus
  // elsewhere in the app can't move the goalposts the poller compares against.
  const startVersionRef = useRef(runningVersion);

  useEffect(() => {
    if (phase !== 'updating') return;
    const startedAt = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - startedAt > UPDATE_TIMEOUT_MS) {
        setPhase('timed_out');
        return;
      }
      try {
        const { data } = await axios.get('/deviceStatus', { timeout: 4_000 });
        if (data?.freeSleep?.version && data.freeSleep.version !== startVersionRef.current) {
          window.location.reload();
        }
      } catch {
        // expected while the service restarts mid-action
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [phase]);

  const start = async (action: () => Promise<unknown>) => {
    startVersionRef.current = runningVersion;
    setPhase('updating');
    try {
      await action();
    } catch {
      // the service restart can drop this request on the floor; the poller
      // decides whether the action actually went through
    }
  };

  const reset = () => setPhase('idle');

  return { phase, start, reset };
}
