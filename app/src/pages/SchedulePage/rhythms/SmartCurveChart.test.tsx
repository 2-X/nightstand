import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SMART } from '@api/rhythmsSchema';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import SmartCurveChart from './SmartCurveChart';
import { defaultNight } from './rhythmsModel';

vi.mock('@mui/x-charts/LineChart', () => ({
  LineChart: ({ xAxis, series }: { xAxis: Array<{ min: Date; max: Date; data: Date[] }>; series: Array<{ data: number[] }> }) =>
    <div data-testid="curve">{ JSON.stringify({ axis: xAxis[0], levels: series[0].data }) }</div>,
  lineElementClasses: { root: 'line' },
  areaElementClasses: { root: 'area' },
}));

const NOTE = "Uses the bed's presence sensing. In a shared bed it can mistake the other sleeper for you; "
  + 'if it stops reporting, the bed follows the clock.';

it('labels the preview and explains the shaded band only with sleep tracking', () => {
  const night = structuredClone(createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left.rhythms.workday.night);
  const props = { night, wake: '06:30', smart: DEFAULT_SMART, date: '2026-09-28', timeZone: 'America/Los_Angeles', format: 'level' as const };
  const { rerender } = render(<SmartCurveChart { ...props } trackingOn/>);
  expect(screen.getByRole('figure', { name: 'Smart Schedule preview: +2 at bedtime, -2 overnight, +2 at wake-up' })).toBeInTheDocument();
  expect(screen.getByTestId('curve').textContent).not.toBe('');
  expect(screen.getByText(/Shaded: the cool-down can start up to 2 hours later/)).toBeInTheDocument();
  expect(screen.getAllByText(NOTE)).toHaveLength(1);
  rerender(<SmartCurveChart { ...props } trackingOn={ false }/>);
  expect(screen.queryByText(/Shaded/)).not.toBeInTheDocument();
  expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  expect(screen.getByText('Follows the clock from bedtime to wake-up.')).toBeInTheDocument();
});

it('draws the held level through wake and keeps the whole night in the domain', () => {
  const night = defaultNight();
  night.power = { ...night.power, on: '20:00', off: '08:00' };
  render(<SmartCurveChart
    night={ night }
    wake="08:00"
    smart={ { ...DEFAULT_SMART, warmUp: false } }
    date="2026-09-28"
    timeZone="America/Los_Angeles"
    format="level"
    trackingOn/>);
  const model = JSON.parse(screen.getByTestId('curve').textContent!) as { axis: { max: string; data: string[] }; levels: number[] };
  const wake = Date.parse('2026-09-29T15:00:00Z');
  expect(Date.parse(model.axis.max)).toBeGreaterThanOrEqual(wake);
  expect(Date.parse(model.axis.data[model.axis.data.length - 1])).toBe(wake);
  expect(model.levels[model.levels.length - 1]).toBe(model.levels[model.levels.length - 2]);
  expect(screen.getByRole('figure')).toHaveAccessibleName('Smart Schedule preview: +2 at bedtime, -2 overnight, -2 at wake-up');
});
