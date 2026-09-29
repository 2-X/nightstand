import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SleepFitnessCard from './SleepFitnessCard';
import SleepStagesCard from './SleepStagesCard';
vi.mock('@api/settings', () => ({ useSettings: () => ({ data: { timeZone: 'UTC' } }) }));
vi.mock('@api/sleepScore', () => ({ useSleepScoreEnabled: () => true, useSleepScore: () => ({ data: { active: true, score: 80 } }) }));
vi.mock('@api/sleepStages.ts', () => ({ useSleepStages: () => ({ data: {
  active: true, epochs: [{ startUnix: 1790542800, endUnix: 1790566200, stage: 'light' }],
  totals: { light: 23400, deep: 0, rem: 0, awake: 1800 }, percentages: { light: 93, deep: 0, rem: 0, awake: 7 },
} }) }));

it('leads with classified sleep and labels bed presence separately without duplicating sleep duration', () => {
  render(<>
    <SleepFitnessCard
      sleepRecord={ {
        id: 1, side: 'left', entered_bed_at: '2026-09-28T00:00:00Z', left_bed_at: '2026-09-28T07:30:00Z',
        sleep_period_seconds: 27000, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
      } }/>
    <SleepStagesCard timeZone="UTC" startTime="2026-09-28T00:00:00Z" endTime="2026-09-28T07:30:00Z"/>
  </>);
  expect(screen.getByText(/7h 30m in bed/)).toBeInTheDocument();
  expect(screen.getAllByText('6h 30m asleep')).toHaveLength(1);
  expect(screen.queryByText(/your .* range/)).not.toBeInTheDocument();
  expect(screen.getByText('Awake')).toBeInTheDocument();
  expect(screen.getByText('3:00 AM')).toBeInTheDocument();
  expect(screen.queryByText('Sleep interruptions')).not.toBeInTheDocument();
});
