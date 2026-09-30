import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Side, useAppStore } from '@state/appStore';
import { useSettings } from '@api/settings';
import { useServices } from '@api/services';
import { postJobs } from '@api/jobs';
import { isConflict } from '@lib/requestError';

type AnalysisRequest = {
  id: number;
  timestamp: string | undefined;
  submitting: boolean;
  error: boolean;
  queued: boolean;
  awaitingJob: boolean;
  expiresAt: number;
};

export default function useAnalyzeSleep() {
  const { side, isUpdating } = useAppStore();
  const { data: settings, isError: settingsError } = useSettings();
  const { data: services, isError: servicesError } = useServices();
  const queryClient = useQueryClient();
  const [requests, setRequests] = useState<Partial<Record<Side, AnalysisRequest>>>({});
  const submitting = useRef<Partial<Record<Side, number>>>({});
  const nextRequestId = useRef(0);
  const previousJobs = useRef<Record<string, { status: string; timestamp?: string }>>({});
  const request = requests[side];
  const job = services?.biometrics?.jobs?.[side === 'left' ? 'analyzeSleepLeft' : 'analyzeSleepRight'];
  const isRunning = job && ['started', 'retrying', 'restarting'].includes(job.status);
  const awaitingJob = request?.awaitingJob && request.timestamp === job?.timestamp;
  const isPending = !!request?.submitting || !!isRunning || !!awaitingJob;
  const error = !!request?.error;
  const alreadyQueued = !!request?.queued && isPending;
  const canAnalyze = !settingsError && !servicesError && !!settings && !!services?.biometrics?.enabled
    && !settings[side]?.awayMode && !isUpdating && !isPending;

  useEffect(() => {
    for (const jobSide of ['left', 'right'] as const) {
      const latestJob = services?.biometrics?.jobs?.[jobSide === 'left' ? 'analyzeSleepLeft' : 'analyzeSleepRight'];
      const previous = previousJobs.current[jobSide];
      if (!latestJob) continue;
      previousJobs.current[jobSide] = { status: latestJob.status, timestamp: latestJob.timestamp };
      const completed = ['healthy', 'waiting_for_data', 'failed'].includes(latestJob.status);
      const completedAt = Date.parse(latestJob.timestamp ?? '');
      // A job can finish while this page is closed. Only expire cached results
      // older than that completion, so returning to fresh history stays cheap.
      if (completed && !previous && Number.isFinite(completedAt)) {
        void queryClient.invalidateQueries({ predicate: query => {
          const resultForSide = (query.queryKey[0] === 'useSleepStages' || query.queryKey[0] === 'useSleepScore')
            && query.queryKey[1] === jobSide;
          return resultForSide && query.state.dataUpdatedAt > 0 && query.state.dataUpdatedAt < completedAt;
        } });
      }
      if (completed && previous && (previous.status !== latestJob.status || previous.timestamp !== latestJob.timestamp)) {
        void queryClient.invalidateQueries({ queryKey: ['useSleepStages', jobSide] });
        void queryClient.invalidateQueries({ queryKey: ['useSleepScore', jobSide] });
        void queryClient.invalidateQueries({ queryKey: ['useSleepRecords'] });
      }
    }
  }, [services, queryClient]);

  // Keep each side's two-minute notification window tied to its own request.
  // A later response or timeout must not replace a newer request's state.
  useEffect(() => {
    const timeouts = (['left', 'right'] as const).flatMap(requestSide => {
      const active = requests[requestSide];
      if (!active?.awaitingJob) return [];
      return [window.setTimeout(() => setRequests(previous => previous[requestSide]?.id === active.id
        ? { ...previous, [requestSide]: { ...previous[requestSide]!, awaitingJob: false } } : previous,
      ), Math.max(0, active.expiresAt - Date.now()))];
    });
    return () => timeouts.forEach(timeout => window.clearTimeout(timeout));
  }, [requests]);
  useEffect(() => {
    if (!isPending) return;
    const interval = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['useServices'] });
      void queryClient.invalidateQueries({ queryKey: ['useSleepRecords'] });
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [isPending, queryClient]);

  const analyze = async () => {
    if (!canAnalyze || submitting.current[side] !== undefined) return;
    const requestSide = side;
    const id = ++nextRequestId.current;
    submitting.current[requestSide] = id;
    setRequests(previous => ({ ...previous, [requestSide]: {
      id, timestamp: job?.timestamp, submitting: true, error: false, queued: false, awaitingJob: true, expiresAt: Date.now() + 120_000,
    } }));
    try {
      await postJobs([requestSide === 'left' ? 'analyzeSleepLeft' : 'analyzeSleepRight']);
      await queryClient.invalidateQueries({ queryKey: ['useServices'] });
      await queryClient.invalidateQueries({ queryKey: ['useSleepRecords'] });
    } catch (failure) {
      if (isConflict(failure)) {
        // The server already has this analysis queued or running.
        setRequests(previous => previous[requestSide]?.id === id
          ? { ...previous, [requestSide]: { ...previous[requestSide]!, queued: true } } : previous);
        void queryClient.invalidateQueries({ queryKey: ['useServices'] });
      } else {
        setRequests(previous => previous[requestSide]?.id === id
          ? { ...previous, [requestSide]: { ...previous[requestSide]!, awaitingJob: false, error: true } } : previous);
      }
    } finally {
      if (submitting.current[requestSide] === id) delete submitting.current[requestSide];
      setRequests(previous => previous[requestSide]?.id === id
        ? { ...previous, [requestSide]: { ...previous[requestSide]!, submitting: false } } : previous);
    }
  };
  return { analyze, canAnalyze, isPending, error, alreadyQueued };
}
