import { useQuery } from '@tanstack/react-query';
import axios from './api';
import { RollbackInfo, UpdateRequest } from './updateSchema.ts';

export const postUpdate = (body: UpdateRequest = {}) => axios.post('/update', body);

export const postRollback = () => axios.post('/update/rollback');

export const postRevertToStock = () => axios.post('/update/revert-to-stock');

export const useRollbackInfo = () => useQuery<RollbackInfo>({
  queryKey: ['useRollbackInfo'],
  queryFn: async () => {
    const response = await axios.get<RollbackInfo>('/update/rollback-info');
    return response.data;
  },
  staleTime: 30_000,
});
