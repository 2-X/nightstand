/* eslint-disable react/no-multi-comp */
import { useState } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { server } from '@test/setup';
import { renderWithProviders } from '@test/renderWithProviders';
import { useSleepStages } from './sleepStages';

function StageResult() {
  const { data } = useSleepStages({ side: 'left', startTime: '2026-09-27T00:00:00Z', endTime: '2026-09-27T08:00:00Z' });
  return <span>{ data ? `${data.totalSeconds} seconds classified` : 'Loading' }</span>;
}

function StageHistory() {
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={ () => setVisible(previous => !previous) }>Toggle history</button>
    { visible && <StageResult/> }
  </>;
}

it('reuses recent classification when history remounts or the window regains focus', async () => {
  let calls = 0;
  server.use(http.get('*/metrics/sleep-stages', () => {
    calls++;
    return HttpResponse.json({
      active: true, epochs: [], totalSeconds: 3600,
      totals: { awake: 0, light: 3600, deep: 0, rem: 0 },
      percentages: { awake: 0, light: 100, deep: 0, rem: 0 },
    });
  }));
  const { user, queryClient } = renderWithProviders(<StageHistory/>);
  await screen.findByText('3600 seconds classified');
  await user.click(screen.getByRole('button', { name: 'Toggle history' }));
  await user.click(screen.getByRole('button', { name: 'Toggle history' }));
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(calls).toBe(1);
  await act(() => queryClient.invalidateQueries({ queryKey: ['useSleepStages', 'left'] }));
  expect(calls).toBe(2);
  focusManager.setFocused(undefined);
});
