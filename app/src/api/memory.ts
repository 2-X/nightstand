import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { MemoryInfo } from './memorySchema.ts';

export const useMemory = (refetchInterval?: number) => {
  return useQuery<MemoryInfo>({
    queryKey: ['useMemory'],
    queryFn: async () => {
      const response = await axios.get<MemoryInfo>('/memory');
      return response.data;
    },
    refetchInterval,
  });
};
