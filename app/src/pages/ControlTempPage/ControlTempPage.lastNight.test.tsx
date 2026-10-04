import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { getDeviceStatus, getSettings } from '../../mocks/mockData';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import ControlTempPage from './ControlTempPage';
import { useControlTempStore } from './controlTempStore';

const night = {
  id: 1, side: 'left', entered_bed_at: '2026-09-22T22:00:00-07:00', left_bed_at: '2026-09-23T06:30:00-07:00',
  sleep_period_seconds: 30_000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};

function leftSide(isOn: boolean) {
  const status = getDeviceStatus();
  server.use(http.get('*/deviceStatus', () => HttpResponse.json({ ...status, left: { ...status.left, isOn } })));
}

describe('last night on the Bed page', () => {
  beforeEach(() => {
    useAppStore.setState({ side: 'left', isUpdating: false });
    useControlTempStore.setState({ commandError: undefined, deviceStatus: undefined, pendingEdits: 0 });
    server.use(
      http.get('*/metrics/sleep', () => HttpResponse.json([night])),
    );
  });

  it('moves under the dial, as time in bed with a link to Sleep, while the side is off', async () => {
    leftSide(false);
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    const link = await screen.findByRole('link', { name: 'View last night\'s sleep' });
    expect(link).toHaveAttribute('href', '/sleep');
    expect(link).toHaveTextContent('View sleep');
    expect(link.closest('[data-controls-row]')).not.toBeNull();
    expect(screen.getByText('Last night: 8h 20m in bed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    // The chip is not shown as well.
    expect(screen.getAllByText(/^Last night:/)).toHaveLength(1);
  });

  it('keeps the chip below the controls while the side is on', async () => {
    leftSide(true);
    const { container } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    expect(await screen.findByText('Last night: 8h 20m in bed')).toBeInTheDocument();
    const chip = container.querySelector('[data-last-night-chip]')!;
    expect(chip).toContainElement(screen.getByRole('link', { name: 'View last night\'s sleep' }));
    expect(screen.getByRole('button', { name: 'Warmer' })).toBeInTheDocument();
  });

  it('moves under the dial for an away side that is on, without the chip', async () => {
    leftSide(true);
    const settings = getSettings();
    server.use(http.get('*/api/settings', () => HttpResponse.json({ ...settings, left: { ...settings.left, awayMode: true } })));
    const { container } = renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    expect(await screen.findByText(/^Away mode is on/)).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'View last night\'s sleep' });
    expect(link.closest('[data-controls-row]')).not.toBeNull();
    expect(screen.getAllByText(/^Last night:/)).toHaveLength(1);
    expect(container.querySelector('[data-last-night-chip]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Warmer' })).not.toBeInTheDocument();
  });

  it('shows the chip with the sleep score feature off, without asking for a score', async () => {
    leftSide(false);
    const settings = getSettings();
    let scored = false;
    server.use(
      http.get('*/api/settings', () => HttpResponse.json({ ...settings, features: { ...settings.features, sleepScore: false } })),
      http.get('*/metrics/sleep-score', () => { scored = true; return HttpResponse.json({}); }),
    );
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    expect(await screen.findByText('Last night: 8h 20m in bed')).toBeInTheDocument();
    expect(scored).toBe(false);
  });

  it.each([
    ['no night was recorded', []],
    ['the night has no time in bed', [{ ...night, sleep_period_seconds: 0 }]],
  ])('shows nothing under the dial when %s', async (_, records) => {
    leftSide(false);
    let answered = 0;
    server.use(http.get('*/metrics/sleep', () => { answered++; return HttpResponse.json(records); }));
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    await screen.findByRole('button', { name: 'Turn on' });
    await waitFor(() => expect(answered).toBeGreaterThan(0));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText(/^Last night/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View last night\'s sleep' })).not.toBeInTheDocument();
  });
});
