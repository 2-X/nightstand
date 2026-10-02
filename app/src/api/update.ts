import { useQuery } from '@tanstack/react-query';
import axios, { LONG_REQUEST_TIMEOUT_MS } from './api';
import { OperationRequest, RollbackInfo, UpdateRequest } from './updateSchema.ts';

export const postUpdate = (body: UpdateRequest = {}) => axios.post('/update', body, { timeout: LONG_REQUEST_TIMEOUT_MS });

export const postRollback = (body?: OperationRequest) => axios.post('/update/rollback', body, { timeout: LONG_REQUEST_TIMEOUT_MS });

export const postRevertToStock = (body?: OperationRequest) => axios.post('/update/revert-to-stock', body, { timeout: LONG_REQUEST_TIMEOUT_MS });

export const useRollbackInfo = () => useQuery<RollbackInfo>({
  queryKey: ['useRollbackInfo'],
  queryFn: async ({ signal }) => {
    const response = await axios.get<RollbackInfo>('/update/rollback-info', { signal });
    return response.data;
  },
  staleTime: 30_000,
});
