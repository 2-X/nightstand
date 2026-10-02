import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { getDeviceStatus } from '../../mocks/mockData';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import ControlTempPage from './ControlTempPage';
import { useControlTempStore } from './controlTempStore';

const night = {
  id: 1, side: 'left', entered_bed_at: '2026-09-22T22:00:00-07:00', left_bed_at: '2026-09-23T06:30:00-07:00',
  sleep_period_seconds: 30_000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
const score = {
  active: true, score: 86,
  components: { duration: { score: 80, weight: 0.4, value: '7h 12m asleep', available: true } },
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
      http.get('*/metrics/sleep-score', () => HttpResponse.json(score)),
    );
  });

  it('moves under the dial, with time asleep and a link to Sleep, while the side is off', async () => {
    leftSide(false);
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    const link = await screen.findByRole('link', { name: 'View sleep' });
    expect(link).toHaveAttribute('href', '/sleep');
    expect(screen.getByText('Last night estimate 86')).toBeInTheDocument();
    expect(screen.getByText('7h 12m asleep')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    // The card below is not shown as well.
    expect(screen.getAllByText(/Last night estimate/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /View sleep/ })).not.toBeInTheDocument();
  });

  it('keeps the card below the controls while the side is on', async () => {
    leftSide(true);
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    expect(await screen.findByRole('button', { name: /^Last night estimate 86 ?View sleep$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase temperature' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View sleep' })).not.toBeInTheDocument();
    expect(screen.queryByText('7h 12m asleep')).not.toBeInTheDocument();
  });

  it.each([
    ['no night was recorded', [], score],
    ['sleep score is off', [night], { active: false, score: null, components: {} }],
  ])('shows nothing under the dial when %s', async (_, records, response) => {
    leftSide(false);
    let answered = 0;
    server.use(
      http.get('*/metrics/sleep', () => { answered++; return HttpResponse.json(records); }),
      http.get('*/metrics/sleep-score', () => { answered++; return HttpResponse.json(response); }),
    );
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    await screen.findByRole('button', { name: 'Turn on' });
    await waitFor(() => expect(answered).toBe(records.length ? 2 : 1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText(/Last night estimate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View sleep' })).not.toBeInTheDocument();
  });

  it('leaves out the duration when the score has none', async () => {
    leftSide(false);
    server.use(http.get('*/metrics/sleep-score', () => HttpResponse.json({
      ...score, components: { duration: { score: 0, weight: 0.4, value: '', available: false } },
    })));
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });

    expect(await screen.findByText('Last night estimate 86')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
