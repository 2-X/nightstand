import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { StorageInfo } from './storageSchema.ts';

export const useStorage = (refetchInterval?: number) => {
  return useQuery<StorageInfo>({
    queryKey: ['useStorage'],
    queryFn: async ({ signal }) => {
      const response = await axios.get<StorageInfo>('/storage', { signal });
      return response.data;
    },
    refetchInterval,
  });
};
