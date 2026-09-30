import axios, { LONG_REQUEST_TIMEOUT_MS } from './api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { retryUpTo } from '@lib/requestError';

export type SleepStage = 'awake' | 'rem' | 'light' | 'deep';

export type StageEpoch = {
  startUnix: number;
  endUnix: number;
  stage: SleepStage;
};

export type SleepStagesResponse = {
  // false when features.sleepScore is off or biometrics itself is off; in
  // that case every field below is an empty/zeroed placeholder rather than
  // a real classification.
  active: boolean;
  epochs: StageEpoch[];
  totals: Record<SleepStage, number>; // seconds per stage
  percentages: Record<SleepStage, number>; // 0..100
  totalSeconds: number;
  // true when too few buckets had vitals to find sleep onset, so the stage
  // totals are not a trustworthy asleep time. Absent from older servers.
  lowCoverage?: boolean;
};

type Args = {
  side: 'left' | 'right';
  startTime?: string;
  endTime?: string;
};

export const sleepStagesQueryOptions = ({ side, startTime, endTime }: Args, enabled = true) =>
  queryOptions({
    queryKey: ['useSleepStages', side, startTime, endTime],
    queryFn: async ({ signal }) => {
      const response = await axios.get<SleepStagesResponse>('/metrics/sleep-stages', {
        params: { side, startTime, endTime },
        signal,
        timeout: LONG_REQUEST_TIMEOUT_MS,
      });
      return response.data;
    },
    gcTime: 60 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    retry: retryUpTo(1),
    enabled: enabled && !!startTime && !!endTime,
  });

export const useSleepStages = (args: Args, enabled = true) => useQuery(sleepStagesQueryOptions(args, enabled));
