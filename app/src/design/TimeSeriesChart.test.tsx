import { expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import TimeSeriesChart from './TimeSeriesChart';

const lineChart = vi.hoisted(() => ({ props: {} as {
  xAxis?: { min: Date; max: Date; tickNumber: number }[];
  series?: { showMark: boolean }[];
  margin?: { right: number };
} }));
vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: (props: typeof lineChart.props) => {
  lineChart.props = props;
  return null;
} }));
it('reserves label space, disables markers, and fixes the time axis to the recording window', () => {
  render(<TimeSeriesChart
    data={ [{ timestamp: new Date('2026-09-28T04:00:00Z'), value: 60 }] }
    startTime="2026-09-28T00:00:00Z"
    endTime="2026-09-28T07:30:00Z"/>);
  expect(lineChart.props.xAxis?.[0].min.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  expect(lineChart.props.xAxis?.[0].max.toISOString()).toBe('2026-09-28T07:30:00.000Z');
  expect(lineChart.props.xAxis?.[0].tickNumber).toBe(3);
  expect(lineChart.props.series?.[0].showMark).toBe(false);
  expect(lineChart.props.margin?.right).toBe(24);
});
