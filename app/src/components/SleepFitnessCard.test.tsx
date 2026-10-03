import { beforeEach, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SleepFitnessCard from './SleepFitnessCard';

const fixture = vi.hoisted(() => ({
  enabled: true, active: true, restingHr: '', scoreError: false, score: 86,
}));
vi.mock('@api/sleepScore', () => ({
  useSleepScoreEnabled: () => fixture.enabled,
  useSleepScore: () => fixture.scoreError ? { data: undefined, isError: true, isPending: false } : ({ data: {
    active: fixture.active, score: fixture.score, components: {
      duration: { score: 90, value: '7h 30m in bed', available: true },
      continuity: { score: 84, value: '1 trip out of bed', available: true },
      hrv: { score: 70, value: '63ms', available: true },
      restingHr: { score: 80, value: fixture.restingHr, available: false },
    } } }),
}));
const record = {
  id: 1, side: 'left', entered_bed_at: '2026-09-28T00:00:00Z', left_bed_at: '2026-09-28T07:30:00Z',
  sleep_period_seconds: 27000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
beforeEach(() => {
  fixture.enabled = true; fixture.active = true; fixture.restingHr = '';
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
  expect(screen.getByText(
    'A rough summary of time in bed and trips out of bed from the bed\'s sensors. '
    + 'It has not been validated and is mostly driven by how long you were in bed.',
  )).toBeInTheDocument();
});
it('shows duration and trips out of bed as contributors, with no heart rate row', async () => {
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('7h 30m in bed', { selector: '.MuiTypography-body2' })).toBeInTheDocument();
  expect(screen.getByText('Trips out of bed')).toBeInTheDocument();
  expect(screen.getByText('1 trip out of bed')).toBeInTheDocument();
  expect(screen.queryByText('Resting HR')).not.toBeInTheDocument();
  expect(screen.queryByText('Not enough data')).not.toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  expect(screen.queryByText('HRV')).not.toBeInTheDocument();
});
it('names the 7h to 9h range, not a personal one, when the night is out of it', () => {
  renderWithProviders(<SleepFitnessCard sleepRecord={ { ...record, sleep_period_seconds: 18000 } } timeZone="UTC"/>);
  expect(screen.getByText('Under the 7h to 9h range for time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/your/)).not.toBeInTheDocument();
});
it('does not turn presence duration into a sleep estimate when classification is disabled', () => {
  fixture.enabled = false;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('7h 30m')).toBeInTheDocument();
  expect(screen.getByText('Detected time in bed')).toBeInTheDocument();
  expect(screen.queryByText(/Sleep score/)).not.toBeInTheDocument();
  expect(screen.queryByText(/asleep/)).not.toBeInTheDocument();
});
it('shows contributor values instead of word bands, and repeats them in the info sheet', async () => {
  fixture.restingHr = '52 bpm';
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Trips out of bed')).toBeInTheDocument();
  expect(screen.getByText('1 trip out of bed')).toBeInTheDocument();
  expect(screen.queryByText('52 bpm')).not.toBeInTheDocument();
  expect(screen.queryByText('Resting HR')).not.toBeInTheDocument();
  expect(screen.queryByText('63 ms')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar', { name: 'HRV contribution' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'About the sleep estimate' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Duration: 7h 30m in bed')).toBeInTheDocument();
  expect(within(dialog).getByText('Trips out of bed: 1 trip out of bed')).toBeInTheDocument();
  expect(within(dialog).getByText('Lowest heart rate (estimate): 52 bpm')).toBeInTheDocument();
  expect(within(dialog).getByText(/^The 7 to 9 hour range is the National Sleep Foundation's recommendation/)).toBeInTheDocument();
  expect(dialog).not.toHaveTextContent('HRV');
});

it('explains in the info sheet that the duration contribution uses time in bed', async () => {
  const { user } = renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  await user.click(screen.getByRole('button', { name: 'About the sleep estimate' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('The duration contribution uses time in bed.')).toBeInTheDocument();
  expect(dialog.queryByText(/asleep|slept/)).not.toBeInTheDocument();
});

it('says the score is unavailable, not that data is missing, when the score request fails', () => {
  fixture.scoreError = true;
  renderWithProviders(<SleepFitnessCard sleepRecord={ record } timeZone="UTC"/>);
  expect(screen.getByText('Score unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
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
