import { beforeEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import moment from 'moment-timezone';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';
import { MAX_TEMPERATURES_PER_DAY } from '@api/schedulesSchema';

const changes = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [
  moment('21:00', 'HH:mm').add((index + 1) * 10, 'minutes').format('HH:mm'), 80,
]));

beforeEach(() => {
  useAppStore.setState({ side: 'right', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(1);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '08:30' } });
});

it('keeps adding temperature changes below the daily limit', () => {
  useScheduleStore.getState().updateSelectedTemperatures(changes(MAX_TEMPERATURES_PER_DAY - 1));
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByRole('button', { name: 'Add temperature change' })).toBeEnabled();
  expect(screen.queryByText(/at most 48/i)).not.toBeInTheDocument();
});

it('stops adding temperature changes at the daily limit and says why', () => {
  useScheduleStore.getState().updateSelectedTemperatures(changes(MAX_TEMPERATURES_PER_DAY));
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByRole('button', { name: 'Add temperature change' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('A day holds at most 48 temperature changes. Remove one to add another.');
});

it('stops adding a warm-up at the daily limit', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedAlarm({ enabled: true, time: '07:00' });
  store.updateSelectedTemperatures(changes(MAX_TEMPERATURES_PER_DAY));
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByRole('button', { name: 'Add warm-up' })).toBeDisabled();
});
