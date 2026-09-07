import axios from './api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecurringAlarm, Side } from '@api/schedulesSchema.ts';

export type RecurringAlarmsBySide = {
  left: RecurringAlarm[];
  right: RecurringAlarm[];
};

// A concrete upcoming occurrence from GET /api/alarms/upcoming.
export type UpcomingOccurrence = {
  side: Side;
  alarmId: string;
  time: string;
  epochMs: number;
  iso: string;
  vibration: { intensity: number; duration: number; pattern: 'double' | 'rise' };
  warmRampMinutes?: number;
  smartWake?: { enabled: boolean; windowMinutes: number };
  // Instant the smart-wake window opens (epochMs - windowMinutes), when enabled.
  smartWakeStartMs?: number;
};

export type UpcomingResponse = {
  hours: number;
  timeZone: string;
  occurrences: UpcomingOccurrence[];
};

export const useRecurringAlarms = () =>
  useQuery<RecurringAlarmsBySide>({
    queryKey: ['useRecurringAlarms'],
    queryFn: async ({ signal }) => {
      const response = await axios.get<RecurringAlarmsBySide>('/alarms', { signal });
      return response.data;
    },
  });

// Replace one side's whole list. The editor holds the full array and PUTs it.
export const useSaveRecurringAlarms = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ side, alarms }: { side: Side; alarms: RecurringAlarm[] }) => {
      const response = await axios.put<RecurringAlarm[]>(`/alarms/${side}`, alarms);
      return response.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['useRecurringAlarms'] });
      void qc.invalidateQueries({ queryKey: ['useUpcomingAlarms'] });
    },
  });
};

export const useUpcomingAlarms = (hours = 12, side?: Side) =>
  useQuery<UpcomingResponse>({
    queryKey: ['useUpcomingAlarms', hours, side ?? 'both'],
    queryFn: async ({ signal }) => {
      const response = await axios.get<UpcomingResponse>('/alarms/upcoming', {
        params: { hours, ...(side ? { side } : {}) },
        signal,
      });
      return response.data;
    },
    refetchInterval: 60_000,
  });
