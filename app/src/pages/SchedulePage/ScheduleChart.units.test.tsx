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
it('labels time and level axes using the selected display format', () => {
  useScheduleStore.setState({ selectedSchedule: getSchedules().left.monday });
  render(<TemperatureScheduleChart/>);
  expect(screen.getByText('Time Level')).toBeInTheDocument();
});
