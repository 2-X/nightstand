import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { useSettings } from './settings.ts';
import { useServices } from './services.ts';

export type SleepScoreComponent = {
  score: number;
  weight: number;
  value: string;
  available: boolean;
};

export type SleepScore = {
  // false when features.sleepScore is off or biometrics itself is off; in
  // that case score is null and components is empty rather than a
  // fabricated result.
  active: boolean;
  score: number | null;
  components: Partial<{
    duration: SleepScoreComponent;
    continuity: SleepScoreComponent;
    hrv: SleepScoreComponent;
    restingHr: SleepScoreComponent;
  }>;
};

type Args = {
  side: 'left' | 'right';
  startTime?: string;
  endTime?: string;
};

export const useSleepScore = ({ side, startTime, endTime }: Args, enabled = true) => {
  return useQuery<SleepScore>({
    queryKey: ['useSleepScore', side, startTime, endTime],
    queryFn: async ({ signal }) => {
      const response = await axios.get<SleepScore>('/metrics/sleep-score', {
        params: { side, startTime, endTime },
        signal,
      });
      return response.data;
    },
    enabled: enabled && !!startTime && !!endTime,
  });
};

// Mirrors the server's isSleepScoreActive: sleep score and stages need real
// biometrics data to mean anything, so the feature is only active when both
// its own flag and biometrics itself are on.
export const useSleepScoreEnabled = (): boolean => {
  const { data: settings } = useSettings();
  const { data: services } = useServices();
  return !!settings?.features.sleepScore && !!services?.biometrics.enabled;
};
