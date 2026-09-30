import { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import api from './api';
import { useSleepScore } from './sleepScore';
import { useSleepStages } from './sleepStages';
import { useBaseConfigured } from './baseControl';
import { createQueryClient } from '@lib/queryClient';

afterEach(() => vi.restoreAllMocks());

const config = { headers: new AxiosHeaders() };
const timeout = () => new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED', config);
const answer = (status: number) => new AxiosError('failed', 'ERR_BAD_RESPONSE', config, undefined,
  { status, statusText: '', headers: {}, config, data: {} });

const args = { side: 'left', startTime: '2026-09-27T00:00:00Z', endTime: '2026-09-27T08:00:00Z' } as const;
const hooks: Record<string, () => unknown> = {
  'sleep score': () => useSleepScore(args),
  'sleep stages': () => useSleepStages(args),
  'base control': () => useBaseConfigured(),
};

const wrapperFor = (client: QueryClient) => function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={ client }>{ children }</QueryClientProvider>;
};

describe.each(Object.entries(hooks))('%s query', (_name, hook) => {
  const wrapper = () => wrapperFor(createQueryClient());

  it('shows a timeout after one wait, without retrying', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(timeout());
    renderHook(hook, { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 1_300));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 4xx answer', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(answer(404));
    renderHook(hook, { wrapper: wrapper() });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 1_300));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

it('retries a server error, at most twice', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValue(answer(503));
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  const { result } = renderHook(() => useSleepScore(args), { wrapper: wrapperFor(client) });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(get).toHaveBeenCalledTimes(3);
});
