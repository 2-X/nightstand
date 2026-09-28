import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getSchedules } from '../../mocks/mockData';
import { useScheduleStore } from './scheduleStore';
import TemperatureScheduleChart from './ScheduleChart';
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { temperatureFormat: 'level' } }) }));
vi.mock('@mui/x-charts/LineChart', () => ({
  LineChart: ({ xAxis, yAxis }: { xAxis: Array<{ label: string }>; yAxis: Array<{ label: string }> }) =>
    <div>{ xAxis[0].label } { yAxis[0].label }</div>,
  lineElementClasses: {}, areaElementClasses: {},
}));
it('labels the temperature axis using the selected display format', () => {
  useScheduleStore.setState({ selectedSchedule: getSchedules().left.monday });
  render(<TemperatureScheduleChart/>);
  expect(screen.getByText('Level')).toBeInTheDocument();
});

it('focuses the matching row when its chart step is selected', () => {
  const schedule = structuredClone(getSchedules().left.monday);
  schedule.temperatures = { '01:00': 83 };
  schedule.power.on = '21:00';
  schedule.power.off = '09:00';
  useScheduleStore.setState({ selectedSchedule: schedule });
  render(<><TemperatureScheduleChart/><div id="schedule-temperature-01:00"><input type="time" aria-label="Change time"/></div></>);
  screen.getByRole('button', { name: /1:00 AM 0/ }).click();
  expect(screen.getByLabelText('Change time')).toHaveFocus();
});
