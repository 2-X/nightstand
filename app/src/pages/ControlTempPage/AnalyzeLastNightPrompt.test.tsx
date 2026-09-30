import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import AnalyzeLastNightPrompt from './AnalyzeLastNightPrompt';
import { useControlTempStore } from './controlTempStore';
import { useAppStore } from '@state/appStore.tsx';

describe('AnalyzeLastNightPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAppStore.setState({ side: 'left', isUpdating: false });
    useControlTempStore.setState({ poweredOff: undefined });
  });
  afterEach(() => vi.useRealTimers());

  it('shows nothing until a side has been turned off', async () => {
    renderWithProviders(<AnalyzeLastNightPrompt/>);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();
  });

  it('waits out the double-tap window after turning off, then offers the analysis', async () => {
    renderWithProviders(<AnalyzeLastNightPrompt/>);
    await act(async () => useControlTempStore.getState().markPoweredOff('left'));

    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2_500));
    expect(await screen.findByRole('button', { name: 'Analyze last night' })).toBeInTheDocument();
  });

  it('goes away after a while and when the side is turned back on', async () => {
    renderWithProviders(<AnalyzeLastNightPrompt/>);
    await act(async () => useControlTempStore.getState().markPoweredOff('left'));
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(await screen.findByRole('button', { name: 'Analyze last night' })).toBeInTheDocument();

    await act(async () => useControlTempStore.getState().clearPoweredOff());
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();

    await act(async () => useControlTempStore.getState().markPoweredOff('left'));
    await act(() => vi.advanceTimersByTimeAsync(25_000));
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();
  });

  it('does nothing at all when the window has already passed', async () => {
    renderWithProviders(<AnalyzeLastNightPrompt/>);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    const timersBefore = vi.getTimerCount();
    await act(async () => useControlTempStore.setState({ poweredOff: { side: 'left', at: Date.now() - 25_000 } }));
    // No show-then-hide timers that would flash the button for a frame.
    expect(vi.getTimerCount()).toBe(timersBefore);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();
  });

  it('does not offer it for the other side', async () => {
    renderWithProviders(<AnalyzeLastNightPrompt/>);
    await act(async () => useControlTempStore.getState().markPoweredOff('right'));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.queryByRole('button', { name: 'Analyze last night' })).not.toBeInTheDocument();
  });
});
