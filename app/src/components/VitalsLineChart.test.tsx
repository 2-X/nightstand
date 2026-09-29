import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VitalsLineChart from './VitalsLineChart';

const chart = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('@design/TimeSeriesChart', () => ({ default: (props: Record<string, unknown>) => { chart.props = props; return null; } }));
it('clips data and pins the chart to the recorded night even if the API returns other times', () => {
  render(<VitalsLineChart
    metric="breathing_rate"
    sevenDayAvg={ 14 }
    timeZone="UTC"
    startTime="2026-09-28T00:00:00Z"
    endTime="2026-09-28T07:30:00Z"
    vitalsRecords={ [-1, 0, 3600, 27000, 28800].map(offset => ({
      side: 'left' as const, timestamp: Date.parse('2026-09-28T00:00:00Z') / 1000 + offset,
      heart_rate: 60, hrv: 65, breathing_rate: 12,
    })) }/>);
  expect(chart.props.data).toHaveLength(3);
  expect(chart.props.startTime).toBe('2026-09-28T00:00:00Z');
  expect(chart.props.endTime).toBe('2026-09-28T07:30:00Z');
  expect(screen.getByText('7-night average 14 breaths/min')).toBeInTheDocument();
  expect(screen.queryByText('SELECTED NIGHT')).not.toBeInTheDocument();
});
