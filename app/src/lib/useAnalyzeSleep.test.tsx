/* eslint-disable react/no-multi-comp */
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore';
import useAnalyzeSleep from './useAnalyzeSleep';

const fixture = vi.hoisted(() => ({ enabled: true, away: false, status: 'healthy', post: vi.fn() }));
vi.mock('@api/services', () => ({ useServices: () => ({ data: { biometrics: {
  enabled: fixture.enabled,
  jobs: { analyzeSleepLeft: { status: fixture.status, timestamp: '2026-09-27T19:00:00Z' } },
} } }) }));
vi.mock('@api/settings', () => ({ useSettings: () => ({ data: {
  left: { awayMode: fixture.away }, right: { awayMode: false },
} }) }));
vi.mock('@api/jobs', () => ({ postJobs: fixture.post }));
function AnalysisControl() {
  const analysis = useAnalyzeSleep();
  return <>
    <button disabled={ !analysis.canAnalyze } onClick={ () => { void analysis.analyze(); void analysis.analyze(); } }>Analyze</button>
    { analysis.isPending && <span>Running</span> }
    { analysis.error && <span>Failed</span> }
  </>;
}
beforeEach(() => {
  fixture.enabled = true; fixture.away = false; fixture.status = 'healthy';
  fixture.post.mockReset().mockResolvedValue({});
  useAppStore.setState({ side: 'left', isUpdating: false });
});
it.each(['off', 'away', 'updating', 'started'])('guards analysis when %s', reason => {
  if (reason === 'off') fixture.enabled = false;
  if (reason === 'away') fixture.away = true;
  if (reason === 'updating') useAppStore.setState({ isUpdating: true });
  if (reason === 'started') fixture.status = 'started';
  renderWithProviders(<AnalysisControl/>);
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  expect(fixture.post).not.toHaveBeenCalled();
});
it('deduplicates simultaneous submissions through the existing side-specific job action', async () => {
  const { user } = renderWithProviders(<AnalysisControl/>);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  await waitFor(() => expect(fixture.post).toHaveBeenCalledExactlyOnceWith(['analyzeSleepLeft']));
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
});
it('releases the pending guard after a failed request so it can be retried', async () => {
  fixture.post.mockRejectedValueOnce(new Error('Failed'));
  const { user } = renderWithProviders(<AnalysisControl/>);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(await screen.findByText('Failed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
});

it('keeps a pending left submission and its late failure off the right side', async () => {
  let failLeft!: (reason: Error) => void;
  fixture.post.mockImplementationOnce(() => new Promise((_, reject) => { failLeft = reject; }));
  const { user } = renderWithProviders(<AnalysisControl/>);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(screen.getByText('Running')).toBeInTheDocument();
  act(() => useAppStore.setState({ side: 'right' }));
  expect(screen.queryByText('Running')).not.toBeInTheDocument();
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
  await act(async () => failLeft(new Error('Left failed')));
  expect(screen.queryByText('Running')).not.toBeInTheDocument();
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  act(() => useAppStore.setState({ side: 'left' }));
  expect(screen.getByText('Failed')).toBeInTheDocument();
});
it('keeps a settled left failure separate when selecting the right side', async () => {
  fixture.post.mockRejectedValueOnce(new Error('Left failed'));
  const { user } = renderWithProviders(<AnalysisControl/>);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(await screen.findByText('Failed')).toBeInTheDocument();
  act(() => useAppStore.setState({ side: 'right' }));
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  expect(screen.queryByText('Running')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
});
it('does not let a late left response clear a new right submission', async () => {
  let failLeft!: (reason: Error) => void;
  let finishRight!: (value: object) => void;
  fixture.post
    .mockImplementationOnce(() => new Promise((_, reject) => { failLeft = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishRight = resolve; }));
  const { user } = renderWithProviders(<AnalysisControl/>);
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  act(() => useAppStore.setState({ side: 'right' }));
  await user.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(fixture.post.mock.calls).toEqual([[['analyzeSleepLeft']], [['analyzeSleepRight']]]);
  await act(async () => failLeft(new Error('Left failed')));
  expect(screen.getByText('Running')).toBeInTheDocument();
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  await act(async () => finishRight({}));
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
});


it('invalidates completed analysis results for the analyzed side only', async () => {
  fixture.status = 'started';
  const { queryClient } = renderWithProviders(<AnalysisControl/>);
  const leftStages = ['useSleepStages', 'left', 'start', 'end'];
  const rightStages = ['useSleepStages', 'right', 'start', 'end'];
  queryClient.setQueryData(leftStages, { active: true });
  queryClient.setQueryData(rightStages, { active: true });
  queryClient.setQueryData(['useSleepScore', 'left', 'start', 'end'], { score: 80 });
  fixture.status = 'healthy';
  act(() => useAppStore.setState({ isUpdating: true }));
  await waitFor(() => expect(queryClient.getQueryState(leftStages)?.isInvalidated).toBe(true));
  expect(queryClient.getQueryState(rightStages)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(['useSleepScore', 'left', 'start', 'end'])?.isInvalidated).toBe(true);
});


function AnalysisPage() {
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={ () => setVisible(previous => !previous) }>Toggle analysis page</button>
    { visible && <AnalysisControl/> }
  </>;
}

it('refreshes cached classifications when returning after analysis completed elsewhere', async () => {
  fixture.status = 'started';
  const { queryClient, user } = renderWithProviders(<AnalysisPage/>);
  const olderStages = ['useSleepStages', 'left', 'older', 'end'];
  const recentStages = ['useSleepStages', 'left', 'recent', 'end'];
  const otherSideStages = ['useSleepStages', 'right', 'older', 'end'];
  queryClient.setQueryData(olderStages, { active: true }, { updatedAt: Date.parse('2026-09-27T18:00:00Z') });
  queryClient.setQueryData(recentStages, { active: true }, { updatedAt: Date.parse('2026-09-27T20:00:00Z') });
  queryClient.setQueryData(otherSideStages, { active: true }, { updatedAt: Date.parse('2026-09-27T18:00:00Z') });
  await user.click(screen.getByRole('button', { name: 'Toggle analysis page' }));
  fixture.status = 'healthy';
  await user.click(screen.getByRole('button', { name: 'Toggle analysis page' }));
  await waitFor(() => expect(queryClient.getQueryState(olderStages)?.isInvalidated).toBe(true));
  expect(queryClient.getQueryState(recentStages)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(otherSideStages)?.isInvalidated).toBe(false);
});
