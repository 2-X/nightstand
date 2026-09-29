import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';

beforeEach(() => {
  useAppStore.setState({ side: 'right', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(1);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '08:30' } });
  useScheduleStore.setState(state => ({ selectedSchedule: { ...state.selectedSchedule!, alarms: [] } }));
  store.selectAlarm(0);
  store.updateSelectedAlarm({ enabled: true, time: '06:30' });
  store.updateSelectedTemperatures({ '01:00': 70, '06:00': 80, '07:00': 90 });
});

it('places a morning change after the anchor alarm in Wake up', () => {
  render(<ScheduleTimeline format="level"/>);
  const night = screen.getByRole('region', { name: 'Through the night' });
  const wake = screen.getByRole('region', { name: 'Wake up' });
  expect(within(night).getByDisplayValue('01:00')).toBeInTheDocument();
  expect(within(night).queryByDisplayValue('07:00')).not.toBeInTheDocument();
  const after = within(wake).getByDisplayValue('07:00');
  const alarm = within(wake).getByDisplayValue('06:30');
  expect(alarm.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(after.compareDocumentPosition(within(wake).getByDisplayValue('08:30')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('groups changes after a wake time that crosses midnight', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedSchedule({ power: { on: '18:00', off: '01:00' } });
  store.updateSelectedAlarm({ time: '23:45' });
  store.updateSelectedTemperatures({ '22:00': 70, '00:15': 90 });
  render(<ScheduleTimeline format="level"/>);
  expect(within(screen.getByRole('region', { name: 'Wake up' })).getByDisplayValue('00:15')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Through the night' })).getByDisplayValue('22:00')).toBeInTheDocument();
});

it('keeps a post-alarm draft row in place while its time is edited', () => {
  render(<ScheduleTimeline format="level"/>);
  const wake = screen.getByRole('region', { name: 'Wake up' });
  const input = within(wake).getByDisplayValue('07:00');
  fireEvent.change(input, { target: { value: '02:00' } });
  fireEvent.blur(input);
  expect(within(wake).getByDisplayValue('02:00')).toBe(input);
});

it('keeps post-anchor changes between the alarms they follow', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedAlarm({ time: '23:00' });
  store.addAlarm();
  store.updateSelectedAlarm({ enabled: true, time: '08:00' });
  store.updateSelectedTemperatures({ '01:00': 70, '08:15': 90 });
  render(<ScheduleTimeline format="level"/>);
  const wake = screen.getByRole('region', { name: 'Wake up' });
  expect(within(wake).getAllByTestId('schedule-event')
    .map(row => row.querySelector('input[type="time"]')?.getAttribute('value')))
    .toEqual(['23:00', '01:00', '08:00', '08:15', '08:30']);
});

it('keeps a frozen post-alarm change visible after bedtime moves earlier', () => {
  render(<ScheduleTimeline format="level"/>);
  const wake = screen.getByRole('region', { name: 'Wake up' });
  const input = within(wake).getByDisplayValue('07:00');
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature at 07:00' }));
  const editedTemperature = useScheduleStore.getState().selectedSchedule?.temperatures['07:00'];
  fireEvent.change(screen.getByLabelText('Turn on at'), { target: { value: '20:00' } });
  expect(within(wake).getByDisplayValue('07:00')).toBe(input);
  expect(within(wake).getByDisplayValue('06:30').compareDocumentPosition(input)
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(useScheduleStore.getState().selectedSchedule?.temperatures['07:00']).toBe(editedTemperature);
});
