import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Slider from './Slider';
const post = vi.hoisted(() => vi.fn());
vi.mock('@api/deviceStatus.ts', () => ({ postDeviceStatus: post, useDeviceStatus: () => ({ data: undefined }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { timeZone: 'UTC', left: { awayMode: false } } }) }));
vi.mock('@api/schedules', () => ({ useSchedules: () => ({ data: undefined }) }));
vi.mock('./useBedSleeps', () => ({ useBedSleeps: () => ({ state: 'legacy' }) }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left', setIsUpdating: vi.fn() }) }));
vi.mock('./TemperatureButtons', () => ({ default: () => <button>Temperature stepper</button> }));

it('shows the target and current temperature without a draggable control', () => {
  render(<Slider isOn currentTargetTemp={ 83 } currentTemperatureF={ 75 } refetch={ vi.fn() } format="level"/>);
  expect(screen.getByRole('heading', { level: 2, name: '0' })).toBeInTheDocument();
  expect(screen.getByText('Currently at -3')).toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('0'));
  fireEvent.pointerMove(screen.getByText('0'));
  fireEvent.pointerUp(screen.getByText('0'));
  expect(post).not.toHaveBeenCalled();
});

it('clamps the active arc endpoints before deciding which arc to draw', () => {
  const { container } = render(<Slider isOn currentTargetTemp={ 83 } currentTemperatureF={ -100 } refetch={ vi.fn() } format="level"/>);
  expect(container.querySelectorAll('path')[1].getAttribute('d')).toContain('A 122 122 0 0 1');
});

it('leaves no empty stepper row when the side is off', () => {
  const { container } = render(<Slider isOn={ false } currentTargetTemp={ 83 } currentTemperatureF={ 75 } refetch={ vi.fn() } format="level"/>);
  expect(screen.queryByText('Temperature stepper')).not.toBeInTheDocument();
  expect(container.firstElementChild?.children).toHaveLength(1);
});
