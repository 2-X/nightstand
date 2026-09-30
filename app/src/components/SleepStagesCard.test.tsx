import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import SleepStagesCard from './SleepStagesCard';

const START = '2026-09-24T22:30:00-07:00';
const END = '2026-09-25T05:10:00-07:00';
const stages = (extra = {}) => ({
  active: true,
  epochs: [{ startUnix: Date.parse(START) / 1000, endUnix: Date.parse(END) / 1000, stage: 'light' }],
  totals: { awake: 0, rem: 1800, light: 18000, deep: 3600 },
  percentages: { awake: 0, rem: 8, light: 76, deep: 15 },
  totalSeconds: 23400,
  ...extra,
});

beforeEach(() => {
  useAppStore.setState({ side: 'left' });
});

describe('Sleep stages card', () => {
  it('keeps the first and last time labels inside the card', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages())));
    renderWithProviders(<SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>);
    // 11 PM sits 7% in, 5 AM sits 97% in; the middle label stays centred.
    expect(await screen.findByText('11:00 PM')).toHaveStyle({ transform: 'translateX(0)' });
    expect(screen.getByText('2:00 AM')).toHaveStyle({ transform: 'translateX(-50%)' });
    expect(screen.getByText('5:00 AM')).toHaveStyle({ transform: 'translateX(-100%)' });
  });

  it('marks the totals as unreliable when stage coverage is low', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages({ lowCoverage: true }))));
    renderWithProviders(<SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>);
    expect(await screen.findByText(/Too few heart readings/i)).toBeInTheDocument();
    expect(screen.queryByText('Deep sleep')).not.toBeInTheDocument();
  });

  it('shows deep and REM totals when coverage is fine', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages())));
    renderWithProviders(<SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>);
    expect(await screen.findByText('Deep sleep')).toBeInTheDocument();
    expect(screen.queryByText(/Too few heart readings/i)).not.toBeInTheDocument();
  });
});
