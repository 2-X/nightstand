import { beforeEach, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SleepFitnessCard from './SleepFitnessCard';

const fixture = vi.hoisted(() => ({
  enabled: true, active: true, epochs: true, lowCoverage: false, restingHr: '', scoreError: false, score: 86,
}));
vi.mock('@api/sleepScore', () => ({
  useSleepScoreEnabled: () => fixture.enabled,
  useSleepScore: () => fixture.scoreError ? { data: undefined, isError: true, isPending: false } : ({ data: {
    active: fixture.active, score: fixture.score, components: {
      duration: { score: 90, value: fixture.lowCoverage || !fixture.epochs ? '7h 30m in bed' : '6h 30m asleep', available: true },
      continuity: { score: 84, value: '84%', available: true },
      hrv: { score: 70, value: '63ms', available: true },
      restingHr: { score: 80, value: fixture.restingHr, available: !!fixture.restingHr },
    } } }),
}));
vi.mock('@api/sleepStages', () => ({ useSleepStages: () => ({ data: {
  active: fixture.active, epochs: fixture.epochs ? [{ stage: 'light' }] : [], lowCoverage: fixture.lowCoverage,
  totals: { light: 18000, deep: 3600, rem: 1800, awake: 3600 },
} }) }));
const record = {
  id: 1, side: 'left', entered_bed_at: '2026-09-28T00:00:00Z', left_bed_at: '2026-09-28T07:30:00Z',
  sleep_period_seconds: 27000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
beforeEach(() => {
  fixture.enabled = true; fixture.active = true; fixture.epochs = true; fixture.lowCoverage = false; fixture.restingHr = '';
  fixture.scoreError = false; fixture.score = 86;
});
it('leads with duration and shows the score as a small estimate, without verdicts', async () => {
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(await screen.findByText(/^Sleep score \d+ \(estimate\)$/)).toBeInTheDocument();
  for (const verdict of ['Good night', 'Fair night', 'Rough night', 'Good', 'Fair', 'Low']) {
    expect(screen.queryByText(verdict)).toBeNull();
  }
});
it('opens with the plain description of what the score is', async () => {
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  await user.click(await screen.findByRole('button', { name: 'About the sleep estimate' }));
  expect(screen.getByText(/^A rough summary of time asleep, trips out of bed and heart rate/)).toBeInTheDocument();
});
it('shows all contributors with unavailable data in words', async () => {
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('6h 30m asleep', { selector: '.MuiTypography-body2' })).toBeInTheDocument();
  expect(screen.getByText('84%')).toBeInTheDocument();
  expect(screen.getByText('Resting HR')).toBeInTheDocument();
  expect(screen.getByText('Not enough data')).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  expect(screen.queryByText('HRV')).not.toBeInTheDocument();
});
it('does not turn presence duration into a sleep estimate when classification is disabled', () => {
  fixture.enabled = false;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('7h 30m')).toBeInTheDocument();
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/Sleep score/)).not.toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
});
it('uses a presence label when classification has no epochs', () => {
  fixture.epochs = false;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
});

it('shows contributor values instead of word bands, and repeats them in the info sheet', async () => {
  fixture.restingHr = '52bpm';
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('52 bpm')).toBeInTheDocument();
  expect(screen.queryByText('63 ms')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar', { name: 'HRV contribution' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'About the sleep estimate' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Duration: 6h 30m asleep')).toBeInTheDocument();
  expect(within(dialog).getByText('Resting HR: 52 bpm')).toBeInTheDocument();
  expect(dialog).not.toHaveTextContent('HRV');
});

it('shows time in bed in the headline and duration when vitals coverage is low', async () => {
  fixture.lowCoverage = true;
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('7h 30m')).toBeInTheDocument();
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'About the sleep estimate' }));
  expect(within(screen.getByRole('dialog')).getByText('Duration: 7h 30m in bed')).toBeInTheDocument();
});

it('says the score is unavailable, not that data is missing, when the score request fails', () => {
  fixture.scoreError = true;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Score unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  expect(screen.queryByText('Not enough data')).not.toBeInTheDocument();
});

it('rounds a fractional score for display', () => {
  fixture.score = 83.456;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Sleep score 83 (estimate)')).toBeInTheDocument();
});

it('rounds the score half up for display', () => {
  fixture.score = 84.6;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Sleep score 85 (estimate)')).toBeInTheDocument();
});
