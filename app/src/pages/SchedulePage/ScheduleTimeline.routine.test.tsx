import { beforeEach, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(0);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '07:30' } });
  useScheduleStore.setState(state => ({ selectedSchedule: { ...state.selectedSchedule!, alarms: [] } }));
  store.selectAlarm(0);
  store.updateSelectedAlarm({ enabled: true, time: '07:00' });
  store.updateSelectedTemperatures({ '02:00': 65, '06:00': 80, '06:43': 90, '07:15': 95, '12:00': 70 });
});

it('groups near-wake changes without hiding unusual or invalid saved times', () => {
  render(<ScheduleTimeline format="level"/>);
  const night = screen.getByRole('region', { name: 'Through the night' });
  const wake = screen.getByRole('region', { name: 'Wake up' });
  expect(within(night).getByDisplayValue('02:00')).toBeInTheDocument();
  expect(within(night).getByDisplayValue('12:00')).toBeInTheDocument();
  for (const time of ['06:00', '07:15']) expect(within(night).getByDisplayValue(time)).toBeInTheDocument();
  expect(within(wake).getByLabelText('Warm up')).toHaveTextContent('17 min before');
  expect(screen.getAllByLabelText('Change at')).toHaveLength(4);
});

it('moves relative power-off with wake across midnight', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedSchedule({ power: { on: '18:00', off: '00:15' } });
  store.updateSelectedAlarm({ time: '23:45' });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Alarm time'), { target: { value: '00:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('00:45');
});

it('keeps edited rows in their section after blur until the draft is discarded', () => {
  render(<ScheduleTimeline format="level"/>);
  const night = screen.getByRole('region', { name: 'Through the night' });
  const input = within(night).getByDisplayValue('02:00');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '06:30' } });
  fireEvent.blur(input);
  expect(within(night).getByDisplayValue('06:30')).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Add temperature change' }));
  expect(screen.getAllByLabelText('Change at')).toHaveLength(5);
  expect(within(night).getByDisplayValue('06:30')).toBe(input);
  act(() => useScheduleStore.getState().reloadScheduleData());
  expect(screen.queryByDisplayValue('06:30')).not.toBeInTheDocument();
});

it('keeps a custom absolute off time when wake moves', () => {
  useScheduleStore.getState().updateSelectedSchedule({ power: { off: '08:42' } });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Alarm time'), { target: { value: '07:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:42');
});

it('moves one inferred warm-up without dropping other changes', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getAllByLabelText('Warm up')[0]);
  fireEvent.click(screen.getByRole('option', { name: '30 min before' }));
  expect(useScheduleStore.getState().selectedSchedule?.temperatures).toEqual({
    '02:00': 65, '06:00': 80, '06:30': 90, '07:15': 95, '12:00': 70,
  });
});

it('opens vibration settings for the selected alarm and edits its strength', () => {
  renderWithProviders(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: /Vibrate/ }));
  const sheet = screen.getByRole('dialog', { name: 'Wake-up vibration' });
  fireEvent.change(within(sheet).getByRole('slider', { name: /Strength/ }), { target: { value: '42' } });
  expect(useScheduleStore.getState().getEditedAlarms()[0].vibrationIntensity).toBe(42);
});

it('steps by levels with keyboard access and stores snapped Fahrenheit', () => {
  useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 83 } });
  render(<ScheduleTimeline format="level"/>);
  const control = screen.getByRole('spinbutton', { name: 'Bedtime temperature' });
  fireEvent.keyDown(control, { key: 'ArrowUp' });
  expect(useScheduleStore.getState().selectedSchedule?.power.onTemperature).toBe(85);
  expect(control).toHaveAttribute('aria-valuenow', '1');
});

it('writes absolute off time from a relative choice', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  fireEvent.click(screen.getByRole('option', { name: '1 hour after' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
});

it('rejects a warm-up collision without overwriting either temperature', () => {
  useScheduleStore.getState().updateSelectedTemperatures({ '06:30': 80, '06:45': 95 });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getAllByLabelText('Warm up')[0]);
  fireEvent.click(screen.getByRole('option', { name: '30 min before' }));
  expect(useScheduleStore.getState().selectedSchedule?.temperatures).toEqual({ '06:30': 80, '06:45': 95 });
  expect(screen.getByRole('alert')).toHaveTextContent(/already exists/);
});

it('shows an absolute off time and keeps all temperature changes editable with the alarm off', () => {
  useScheduleStore.getState().updateSelectedAlarm({ enabled: false });
  render(<ScheduleTimeline format="level"/>);
  const getUp = screen.getByRole('region', { name: 'Get up' });
  expect(within(getUp).getByLabelText('Turn off at')).toHaveValue('07:30');
  expect(screen.queryByLabelText('Turn off')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Through the night' })).getAllByLabelText('Change at')).toHaveLength(5);
});


it('restores relative off behavior after discarding a custom off edit', () => {
  const store = useScheduleStore.getState();
  const original = structuredClone(store.originalSchedules!);
  original.left.sunday = structuredClone(store.selectedSchedule!);
  store.setOriginalSchedules(original);
  store.checkForChanges();
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  fireEvent.click(screen.getByRole('option', { name: 'At a set time' }));
  fireEvent.change(screen.getByLabelText('Turn off at'), { target: { value: '08:42' } });
  act(() => useScheduleStore.getState().reloadScheduleData());
  fireEvent.change(screen.getByLabelText('Alarm time'), { target: { value: '07:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:45');
});
