import axios from './api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ServerStatus } from './serverStatusSchema.ts';

type StatusClock = { podTime: number; receivedAt: number };
export type ServerStatusSnapshot = { status: ServerStatus; clock?: StatusClock };

export const useServerStatus = (refetchInterval?: number) => {
  const queryClient = useQueryClient();
  const query = useQuery<ServerStatusSnapshot>({
    queryKey: ['useServerStatus'],
    queryFn: async ({ signal }) => {
      const response = await axios.get<ServerStatus>('/serverStatus', { signal });
      const receivedAt = performance.now();
      const dateHeader: unknown = response.headers.date;
      let podTime = typeof dateHeader === 'string' ? Date.parse(dateHeader) : NaN;
      if (!Number.isFinite(podTime)) {
        const previous = queryClient.getQueryData<ServerStatusSnapshot>(['useServerStatus']);
        const startedAt = response.data.express?.timestamp;
        // Without HTTP Date, wait a full grace period after first observing this
        // startup. Repeated checks retain elapsed time without using the phone clock.
        podTime = previous?.clock && startedAt && startedAt === previous.status.express?.timestamp
          ? previous.clock.podTime + Math.max(0, receivedAt - previous.clock.receivedAt)
          : Date.parse(startedAt ?? '');
      }
      return {
        status: response.data,
        clock: Number.isFinite(podTime) ? { podTime, receivedAt } : undefined,
      };
    },
    refetchInterval,
  });
  return { ...query, data: query.data?.status, clock: query.data?.clock };
};
