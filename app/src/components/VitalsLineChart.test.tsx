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
  // Three readings hours apart: three lone points with the holes between them kept.
  expect((chart.props.data as { value: number | null }[]).filter(point => point.value !== null)).toHaveLength(3);
  expect(chart.props.startTime).toBe('2026-09-28T00:00:00Z');
  expect(chart.props.endTime).toBe('2026-09-28T07:30:00Z');
  expect(screen.getByText('7-night average 14 breaths/min')).toBeInTheDocument();
  expect(screen.queryByText('SELECTED NIGHT')).not.toBeInTheDocument();
});

it('does not shade a target band behind HRV', () => {
  const timestamp = Date.parse('2026-09-28T01:00:00Z') / 1000;
  render(<VitalsLineChart
    metric="hrv"
    timeZone="UTC"
    startTime="2026-09-28T00:00:00Z"
    endTime="2026-09-28T07:30:00Z"
    vitalsRecords={ [{ side: 'left' as const, timestamp, heart_rate: 60, hrv: 65, breathing_rate: 12 }] }/>);
  expect(chart.props.targetRange).toBeUndefined();
});

const minuteRecords = (from: number, to: number, breathing: number) => Array.from({ length: to - from }, (_, index) => ({
  side: 'left' as const, timestamp: Date.parse('2026-09-28T00:00:00Z') / 1000 + (from + index) * 60,
  heart_rate: 60, hrv: 65, breathing_rate: breathing, resp_rate: breathing,
}));

it('breaks the line across a hole in the readings instead of averaging over it', () => {
  render(<VitalsLineChart
    metric="breathing_rate"
    timeZone="UTC"
    startTime="2026-09-28T00:00:00Z"
    endTime="2026-09-28T07:30:00Z"
    vitalsRecords={ [...minuteRecords(0, 120, 12), ...minuteRecords(150, 270, 18)] }/>);
  const data = chart.props.data as { timestamp: Date; value: number | null }[];
  const gaps = data.flatMap((point, index) => (point.value === null ? [index] : []));
  expect(gaps).toHaveLength(1);
  expect(data.slice(0, gaps[0]).every(point => point.value === 12)).toBe(true);
  expect(data.slice(gaps[0] + 1).every(point => point.value === 18)).toBe(true);
  expect(data.length).toBeLessThanOrEqual(52);
});

it.each(['breathing_rate', 'resp_rate', 'heart_rate', 'hrv'] as const)('shades no band behind %s', metric => {
  render(<VitalsLineChart
    metric={ metric }
    timeZone="UTC"
    startTime="2026-09-28T00:00:00Z"
    endTime="2026-09-28T07:30:00Z"
    vitalsRecords={ minuteRecords(0, 30, 14) }/>);
  expect(chart.props).not.toHaveProperty('targetRange');
});
