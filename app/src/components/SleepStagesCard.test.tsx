import { screen, waitFor } from '@testing-library/react';
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

  it('shows estimated sleep and wake, without deep sleep or REM', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages())));
    renderWithProviders(<SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>);
    expect(await screen.findByText('Estimated sleep and wake')).toBeInTheDocument();
    expect(await screen.findAllByText('Asleep')).not.toHaveLength(0);
    expect(screen.getByText('From heart rate and movement. Not compared with a sleep study.')).toBeInTheDocument();
    for (const gone of ['Deep sleep', 'REM', 'Light', 'Too few heart readings']) {
      expect(screen.queryByText(new RegExp(gone))).toBeNull();
    }
    expect(screen.getAllByText('Asleep').length).toBeGreaterThan(0);
  });

  it('shows no stage totals even when coverage is low', async () => {
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages({ lowCoverage: true }))));
    renderWithProviders(<SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>);
    expect(await screen.findByText('Asleep')).toBeInTheDocument();
    expect(screen.queryByText(/Too few heart readings/)).toBeNull();
  });

  it('draws deep, light and REM epochs as one asleep segment', async () => {
    const t0 = Date.parse(START) / 1000;
    const epochs = ['light', 'deep', 'rem', 'awake', 'deep'].map((stage, i) => (
      { startUnix: t0 + i * 1800, endUnix: t0 + (i + 1) * 1800, stage }
    ));
    server.use(http.get('*/metrics/sleep-stages', () => HttpResponse.json(stages({ epochs }))));
    const { container } = renderWithProviders(
      <SleepStagesCard startTime={ START } endTime={ END } timeZone="America/Los_Angeles"/>,
    );
    // asleep, awake, asleep
    await waitFor(() => expect(container.querySelectorAll('svg rect')).toHaveLength(3));
  });
});
