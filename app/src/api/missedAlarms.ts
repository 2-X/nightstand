import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from './api';

// Keep in step with server/src/jobs/alarmLedger.ts.
export type MissedAlarm = {
  id: string; side: 'left' | 'right'; at: string;
  reason: 'not-running' | 'late' | 'failed' | 'unconfirmed' | 'error' | 'side-off'; recordedAt: string;
};

export const useMissedAlarms = () => useQuery({
  queryKey: ['missedAlarms'],
  queryFn: async ({ signal }) => {
    const { data } = await axios.get<{ missed?: unknown }>('/alarms/missed', { signal });
    return Array.isArray(data?.missed) ? data.missed as MissedAlarm[] : [];
  },
  staleTime: 60_000,
  retry: false,
});

export const useDismissMissedAlarms = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => axios.post('/alarms/missed/dismiss', { ids }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['missedAlarms'] }),
  });
};
