import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SleepFitnessCard from './SleepFitnessCard';

const fixture = vi.hoisted(() => ({ enabled: true, active: true, epochs: true, restingHr: '' }));
vi.mock('@api/sleepScore', () => ({
  useSleepScoreEnabled: () => fixture.enabled,
  useSleepScore: () => ({ data: { active: fixture.active, score: 86, components: {
    duration: { score: 90, value: '7.5h', available: true },
    continuity: { score: 84, value: '84%', available: true },
    hrv: { score: 70, value: '63ms', available: true },
    restingHr: { score: 80, value: fixture.restingHr, available: !!fixture.restingHr },
  } } }),
}));
vi.mock('@api/sleepStages', () => ({ useSleepStages: () => ({ data: {
  active: fixture.active, epochs: fixture.epochs ? [{ stage: 'light' }] : [],
  totals: { light: 18000, deep: 3600, rem: 1800, awake: 3600 },
} }) }));
const record = {
  id: 1, side: 'left', entered_bed_at: '2026-09-28T00:00:00Z', left_bed_at: '2026-09-28T07:30:00Z',
  sleep_period_seconds: 27000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
beforeEach(() => { fixture.enabled = true; fixture.active = true; fixture.epochs = true; fixture.restingHr = ''; });
it('leads with the estimate and shows all contributors with unavailable data in words', async () => {
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('86')).toBeInTheDocument();
  expect(screen.getByText('Good night')).toBeInTheDocument();
  expect(screen.getByText('6h 30m asleep')).toBeInTheDocument();
  expect(screen.getByText('Resting HR')).toBeInTheDocument();
  expect(screen.getByText('Not enough data')).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'About the sleep estimate' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('has not been validated');
  expect(screen.getByRole('dialog')).toHaveTextContent('not a medical measurement');
});
it('does not turn presence duration into a sleep estimate when classification is disabled', () => {
  fixture.enabled = false;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('7h 30m')).toBeInTheDocument();
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText('86')).not.toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
});
it('uses a presence label when classification has no epochs', () => {
  fixture.epochs = false;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
});

it('formats duration consistently and explains the filtered HRV contributor', () => {
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Duration')).toBeInTheDocument();
  expect(screen.getByText('7h 30m')).toBeInTheDocument();
  expect(screen.queryByText('7.5h')).not.toBeInTheDocument();
  expect(screen.getByText('HRV (filtered)')).toBeInTheDocument();
  expect(screen.getByText('63 ms')).toBeInTheDocument();
  expect(screen.getByText(/Score uses HRV readings from 30 to 120 ms/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'HRV (filtered) contribution' })).toHaveAttribute('aria-valuenow', '70');
});

it.each(['52bpm', '52 bpm'])('separates the resting heart rate and its unit for %s', value => {
  fixture.restingHr = value;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('52 bpm')).toBeInTheDocument();
  expect(screen.getByText('63 ms')).toBeInTheDocument();
});
