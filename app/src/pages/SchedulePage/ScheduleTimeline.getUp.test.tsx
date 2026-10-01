import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';

const HELPER = "After your wake time, it turns off once you've been out of bed for 10 minutes and your alarms are done."
  + ' Still in bed at 8:30 AM? It stays on at your wake temperature until you get up, for up to 3 more hours.';

beforeEach(() => {
  useAppStore.setState({ side: 'right', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
  const night = structuredClone(getSchedules().right.monday);
  night.power = { ...night.power, enabled: true, on: '21:00', off: '08:30' };
  night.temperatures = {};
  night.alarms = [];
  night.alarm = { ...night.alarm, enabled: false };
  useScheduleStore.getState().editNight(night);
});

type GetUp = { on: boolean; tracking: boolean; onChange: (on: boolean) => void };
const timeline = (getUp?: GetUp, onWake = vi.fn()) => render(<ScheduleTimeline
  format="level"
  hideTemperatures
  wake={ { time: '06:30', onChange: onWake } }
  getUp={ getUp }/>);

it('offers "When I get up" only for a rhythm that asks for it, and chooses it', () => {
  const { unmount } = timeline();
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  expect(screen.queryByRole('option', { name: 'When I get up' })).not.toBeInTheDocument();
  unmount();

  const onChange = vi.fn();
  timeline({ on: false, tracking: true, onChange });
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  fireEvent.click(screen.getByRole('option', { name: 'When I get up' }));
  expect(onChange).toHaveBeenCalledWith(true);
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:30');
});

it('keeps the set off as the usual one and explains the choice', () => {
  timeline({ on: true, tracking: true, onChange: vi.fn() });
  expect(screen.getByLabelText('Turn off')).toHaveTextContent('When I get up');
  expect(screen.getByLabelText('Usually off at')).toHaveValue('08:30');
  expect(screen.queryByLabelText('Turn off at')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Turns off at/)).not.toBeInTheDocument();
  expect(screen.getByText(HELPER)).toBeInTheDocument();
});

it('needs Biometrics: the choice is disabled, and a saved one says the set time applies', () => {
  const { unmount } = timeline({ on: false, tracking: false, onChange: vi.fn() });
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  expect(screen.getByRole('option', { name: 'When I get up' })).toHaveAttribute('aria-disabled', 'true');
  unmount();

  timeline({ on: true, tracking: false, onChange: vi.fn() });
  expect(screen.getByText('Needs Biometrics. Until it is on, the bed turns off at 8:30 AM.')).toBeInTheDocument();
});

it('switches back to a time after the wake', () => {
  const onChange = vi.fn();
  timeline({ on: true, tracking: true, onChange });
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  fireEvent.click(screen.getByRole('option', { name: '15 min after' }));
  expect(onChange).toHaveBeenCalledWith(false);
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('06:45');
});

it('leaves the usual off where it is when the wake time moves', () => {
  useScheduleStore.getState().updateSelectedSchedule({ power: { off: '07:00' } });
  timeline({ on: true, tracking: true, onChange: vi.fn() });
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:00');
});
