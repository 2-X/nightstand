import axios from './api';
import { useQuery } from '@tanstack/react-query';

// One row of the Phase 0 bed_state_samples table (server/prisma/schema.prisma).
// timestamp is epoch SECONDS.
export type BedStateSample = {
  id: number;
  side: 'left' | 'right';
  timestamp: number;
  current_level: number | null;
  target_level: number | null;
  current_temp_f: number | null;
  target_temp_f: number | null;
  is_on: boolean;
};

type Args = {
  side: 'left' | 'right';
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
};

// GET /api/metrics/temperature?side=&startTime=&endTime=
// With a side filter and no includeHub, the server returns the bed sample rows
// directly (an array), not the { bed, hub } envelope.
export const useTemperatureHistory = ({ side, startTime, endTime }: Args, enabled = true) =>
  useQuery<BedStateSample[]>({
    queryKey: ['useTemperatureHistory', side, startTime, endTime],
    queryFn: async ({ signal }) => {
      const response = await axios.get<BedStateSample[]>('/metrics/temperature', {
        params: { side, startTime, endTime },
        signal,
      });
      return response.data;
    },
    enabled: enabled && !!startTime && !!endTime,
    // A gentle refetch as a safety net; live points arrive over the WS
    // device-status stream and are appended client-side on the Tonight page.
    refetchInterval: 60_000,
  });
