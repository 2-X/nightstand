import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SMART } from '@api/rhythmsSchema';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import SmartCurveChart from './SmartCurveChart';

vi.mock('@mui/x-charts/LineChart', () => ({
  LineChart: ({ series }: { series: Array<{ data: number[] }> }) => <div data-testid="curve">{ series[0].data.join(',') }</div>,
  lineElementClasses: { root: 'line' },
  areaElementClasses: { root: 'area' },
}));

it('labels the preview and explains the shaded band only with sleep tracking', () => {
  const night = structuredClone(createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left.rhythms.workday.night);
  const props = { night, wake: '06:30', smart: DEFAULT_SMART, date: '2026-09-28', timeZone: 'America/Los_Angeles', format: 'level' as const };
  const { rerender } = render(<SmartCurveChart { ...props } trackingOn/>);
  expect(screen.getByRole('figure', { name: 'Smart Schedule preview: +2 at bedtime, -2 overnight, +2 at wake-up' })).toBeInTheDocument();
  expect(screen.getByTestId('curve').textContent).not.toBe('');
  expect(screen.getByText(/Shaded: the cool-down can start up to 2 hours later/)).toBeInTheDocument();
  rerender(<SmartCurveChart { ...props } trackingOn={ false }/>);
  expect(screen.queryByText(/Shaded/)).not.toBeInTheDocument();
  expect(screen.getByText('Follows the clock from bedtime to wake-up.')).toBeInTheDocument();
});
