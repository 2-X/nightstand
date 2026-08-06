import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { ServerStatus } from './serverStatusSchema.ts';


export const useServerStatus = (refetchInterval?: number) => {
  return useQuery<ServerStatus>({
    queryKey: ['useServerStatus'],
    queryFn: async ({ signal }) => {
      const response = await axios.get<ServerStatus>('/serverStatus', { signal });
      return response.data;
    },
    refetchInterval,
  });
};
