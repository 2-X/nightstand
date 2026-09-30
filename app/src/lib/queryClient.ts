import { QueryClient } from '@tanstack/react-query';
import { retryUpTo } from './requestError';

export const createQueryClient = () => new QueryClient({
  defaultOptions: { queries: { retry: retryUpTo(2) } },
});
