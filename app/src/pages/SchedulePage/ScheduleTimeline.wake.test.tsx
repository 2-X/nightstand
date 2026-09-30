import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ScheduleTimeline from './ScheduleTimeline';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(1);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '07:30' } });
  useScheduleStore.setState(state => ({ selectedSchedule: { ...state.selectedSchedule!, alarms: [] } }));
  store.selectAlarm(0);
  store.updateSelectedAlarm({ enabled: true, time: '07:00' });
  store.updateSelectedTemperatures({ '06:00': 83, '06:45': 99 });
});

it.each(['18:00', '18:59', '19:00', '20:30'])('keeps turn-off and explains a wake edit to %s that reaches the wrong bedtime', time => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: time } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:30');
  expect(screen.getByText('Wake time is before bedtime, so turn off was not moved.')).toBeInTheDocument();
  expect(useScheduleStore.getState().isValid()).toBe(false);
});

it('follows a later wake time in the same morning', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:30' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
});

it('groups only the last change strictly less than an hour before wake as the warm-up', () => {
  render(<ScheduleTimeline format="level"/>);
  const night = screen.getByRole('region', { name: 'Through the night' });
  const wake = screen.getByRole('region', { name: 'Wake up' });
  expect(within(night).getByDisplayValue('06:00')).toBeInTheDocument();
  expect(within(night).queryByText('Keep the bedtime temperature until wake-up.')).not.toBeInTheDocument();
  expect(within(wake).getAllByLabelText('Warm up')).toHaveLength(1);
  expect(within(wake).queryByDisplayValue('06:45')).not.toBeInTheDocument();
  fireEvent.mouseDown(within(wake).getByLabelText('Warm up'));
  expect(screen.queryByRole('option', { name: 'Off' })).not.toBeInTheDocument();
});

it('keeps a lone change exactly an hour before wake through the night', () => {
  useScheduleStore.getState().updateSelectedTemperatures({ '06:00': 83 });
  render(<ScheduleTimeline format="level"/>);
  expect(within(screen.getByRole('region', { name: 'Through the night' })).getByDisplayValue('06:00')).toBeInTheDocument();
  expect(screen.queryByLabelText('Warm up')).not.toBeInTheDocument();
});

it('recomputes grouping after focus without a temperature edit when wake changes', () => {
  useScheduleStore.getState().updateSelectedTemperatures({ '06:15': 83, '06:45': 99 });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.focus(screen.getByDisplayValue('06:15'));
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '08:45' } });
  const night = screen.getByRole('region', { name: 'Through the night' });
  expect(within(night).getByDisplayValue('06:15')).toBeInTheDocument();
  expect(within(night).getByDisplayValue('06:45')).toBeInTheDocument();
  expect(screen.queryByLabelText('Warm up')).not.toBeInTheDocument();
});

it('anchors warm-up to the earliest enabled alarm and turn-off to the latest', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedAlarm({ time: '08:00' });
  store.updateSelectedSchedule({ power: { off: '08:30' } });
  store.addAlarm();
  store.updateSelectedAlarm({ enabled: true, time: '07:00' });
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByLabelText('Warm up')).toHaveTextContent('15 min before');
  fireEvent.change(screen.getByDisplayValue('07:00'), { target: { value: '07:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:30');
});

it.each(['21:15', '21:30'])('hides add warm-up when a thirty-minute lead for %s reaches bedtime', time => {
  useScheduleStore.getState().updateSelectedAlarm({ time });
  useScheduleStore.getState().updateSelectedTemperatures({});
  render(<ScheduleTimeline format="level"/>);
  expect(screen.queryByRole('button', { name: 'Add warm-up' })).not.toBeInTheDocument();
});

it('keeps a disabled alarm time visible and editable without enabling it', () => {
  useScheduleStore.getState().updateSelectedAlarm({ enabled: false });
  render(<ScheduleTimeline format="level"/>);
  const input = screen.getByLabelText('Wake at');
  expect(input).toHaveValue('07:00');
  fireEvent.change(input, { target: { value: '08:10' } });
  expect(useScheduleStore.getState().getEditedAlarms()[0]).toMatchObject({ enabled: false, time: '08:10' });
});

it('explains when an absolute turn-off matches a relative preset', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByLabelText('Turn off'));
  fireEvent.click(screen.getByRole('option', { name: 'At a set time' }));
  expect(screen.getByText('Matches 30 min after wake, so it will move with your wake time.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Turn off at'), { target: { value: '08:12' } });
  expect(screen.queryByText(/Matches .*wake/)).not.toBeInTheDocument();
});

it('follows the latest alarm when an edited wake passes another alarm', () => {
  const store = useScheduleStore.getState();
  store.addAlarm();
  store.updateSelectedAlarm({ enabled: true, time: '08:00' });
  store.updateSelectedSchedule({ power: { off: '08:30' } });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getAllByLabelText('Wake at')[0], { target: { value: '08:15' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:45');
});

it('keeps only one warm-up when another temperature change is added during a draft', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedSchedule({ power: { on: '06:00', off: '07:30' } });
  store.updateSelectedAlarm({ time: '07:15' });
  store.updateSelectedTemperatures({ '06:30': 90 });
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Add temperature change' }));
  expect(screen.getAllByLabelText('Warm up')).toHaveLength(1);
  expect(within(screen.getByRole('region', { name: 'Through the night' })).getByDisplayValue('07:00')).toHaveFocus();
});

it('focuses a newly added warm-up without changing the alarm', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedTemperatures({});
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Add warm-up' }));
  expect(screen.getByRole('combobox', { name: 'Warm up' })).toHaveFocus();
  expect(store.getEditedAlarms()[0].time).toBe('07:00');
  expect(useScheduleStore.getState().selectedSchedule?.temperatures).toEqual({ '06:30': store.selectedSchedule!.power.onTemperature });
});

it('clears the rejected-wake warning and resumes relative turn-off after correcting the wake time', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '19:00' } });
  expect(screen.getByText('Wake time is before bedtime, so turn off was not moved.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:15' } });
  expect(screen.queryByText('Wake time is before bedtime, so turn off was not moved.')).not.toBeInTheDocument();
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:45');
});

it('recomputes warm-up membership after editing a temperature and moving wake earlier or later', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature at 06:00' }));
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '06:20' } });
  expect(screen.getByLabelText('Warm up')).toHaveTextContent('20 min before');
  expect(within(screen.getByRole('region', { name: 'Wake up' })).getByDisplayValue('06:45')).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText('Warm up'));
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['15 min before', '20 min before', '30 min before']);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '09:00' } });
  expect(screen.queryByLabelText('Warm up')).not.toBeInTheDocument();
  expect(screen.getAllByLabelText('Change at').map(input => (input as HTMLInputElement).value)).toEqual(['06:00', '06:45']);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:00' } });
  expect(screen.getByLabelText('Warm up')).toHaveTextContent('15 min before');
});

it('keeps the chosen relative turn-off through a rejected wake and bedtime edit', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  fireEvent.click(screen.getByRole('option', { name: '15 min after' }));
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '19:00' } });
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('15 min after');
  expect(screen.queryByLabelText('Turn off at')).not.toBeInTheDocument();
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:15');
  fireEvent.change(screen.getByLabelText('Turn on at'), { target: { value: '22:00' } });
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('15 min after');
  expect(screen.getByText('Wake time is before bedtime, so turn off was not moved.')).toBeInTheDocument();
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:15');
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:30' } });
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('15 min after');
  expect(screen.queryByText('Wake time is before bedtime, so turn off was not moved.')).not.toBeInTheDocument();
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:45');
});

it('regroups a newly added warm-up when wake returns to its original time', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Increase temperature at 06:00' }));
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add warm-up' }));
  expect(screen.getByLabelText('Warm up')).toHaveTextContent('30 min before');
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '07:00' } });
  expect(screen.getByLabelText('Warm up')).toHaveTextContent('15 min before');
  expect(within(screen.getByRole('region', { name: 'Wake up' })).getByDisplayValue('08:30')).toBeInTheDocument();
});

it('resumes a rejected relative turn-off when changing bedtime makes the wake valid', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '19:00' } });
  expect(screen.getByText('Wake time is before bedtime, so turn off was not moved.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Turn on at'), { target: { value: '18:00' } });
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('30 min after');
  expect(screen.queryByText('Wake time is before bedtime, so turn off was not moved.')).not.toBeInTheDocument();
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('19:30');
});

it('shows every legacy alarm and explains the add limit while permitting edits', () => {
  const schedules = structuredClone(getSchedules());
  schedules.left.monday.alarms = Array.from({ length: 12 }, () => ({ ...schedules.left.monday.alarm, enabled: true, time: '07:00' }));
  useScheduleStore.getState().setOriginalSchedules(schedules);
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByText(/12 alarms are saved/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add alarm' })).toBeDisabled();
  expect(useScheduleStore.getState().getEditedAlarms()).toHaveLength(12);
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it('extends a following turn-off when a later alarm is added', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  expect(useScheduleStore.getState().getEditedAlarms()[1].time).toBe('07:30');
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
  expect(useScheduleStore.getState().isValid()).toBe(true);
  fireEvent.change(screen.getAllByLabelText('Wake at')[1], { target: { value: '07:45' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:15');
  expect(useScheduleStore.getState().isValid()).toBe(true);
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('30 min after');
});

it('follows the latest alarm when the first alarm is moved past it', () => {
  const store = useScheduleStore.getState();
  store.addAlarm();
  store.updateSelectedAlarm({ time: '07:30' });
  store.updateSelectedSchedule({ power: { off: '08:00' } });
  render(<ScheduleTimeline format="level"/>);
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('30 min after');
  fireEvent.change(screen.getAllByLabelText('Wake at')[0], { target: { value: '08:00' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:30');
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it('names Turn off when an alarm falls after a set turn-off time', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  fireEvent.click(screen.getByRole('option', { name: 'At a set time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  fireEvent.change(screen.getAllByLabelText('Wake at')[1], { target: { value: '08:30' } });
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:30');
  expect(useScheduleStore.getState().isValid()).toBe(false);
  expect(screen.getByText('Turn off is at 7:30 AM, before this alarm. Move Turn off later or pick an earlier time.')).toBeInTheDocument();
});

it('names the last alarm in the turn-off options once there is more than one', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  expect(screen.getAllByRole('option').map(option => option.textContent))
    .toEqual(['At wake time', '15 min after', '30 min after', '1 hour after', 'At a set time']);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  expect(screen.getAllByRole('option').map(option => option.textContent))
    .toEqual(['At last alarm', '15 min after last alarm', '30 min after last alarm', '1 hour after last alarm', 'At a set time']);
});

it('keeps a following turn-off anchored when the last alarm is switched off, on again or removed', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
  fireEvent.click(screen.getByRole('switch', { name: 'Enable alarm 2' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:30');
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('30 min after');
  expect(screen.queryByLabelText('Turn off at')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: 'Enable alarm 2' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
  fireEvent.click(screen.getByRole('button', { name: 'Remove alarm 2' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('07:30');
  expect(screen.getByRole('combobox', { name: 'Turn off' })).toHaveTextContent('30 min after');
});

it('leaves a set turn-off time alone when an alarm is switched off', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  fireEvent.click(screen.getByRole('option', { name: 'At a set time' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Enable alarm 2' }));
  expect(useScheduleStore.getState().selectedSchedule?.power.off).toBe('08:00');
});

it('seeds a new alarm inside a full-day night', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedSchedule({ power: { on: '21:00', off: '21:00' } });
  store.updateSelectedAlarm({ time: '20:45' });
  useScheduleStore.getState().addAlarm();
  const alarms = useScheduleStore.getState().getEditedAlarms();
  expect(alarms[1].time).toBe('20:59');
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it('seeds a new alarm inside the night when turn-off is a set time', () => {
  render(<ScheduleTimeline format="level"/>);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Turn off' }));
  fireEvent.click(screen.getByRole('option', { name: 'At a set time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add alarm' }));
  expect(useScheduleStore.getState().getEditedAlarms().map(alarm => alarm.time)).toEqual(['07:00', '07:30', '07:29']);
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it('does not add an alarm at the same minute as one that ends the night', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedSchedule({ power: { on: '21:00', off: '07:00' } });
  store.updateSelectedAlarm({ time: '07:00' });
  store.addAlarm();
  const times = useScheduleStore.getState().getEditedAlarms().map(alarm => alarm.time);
  expect(new Set(times).size).toBe(times.length);
  expect(times).toEqual(['07:00', '06:59']);
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it.each([
  [true, 'Builds up'],
  [false, 'Double pulse'],
])('summarizes a rising alarm by the pattern the Pod uses (Pod 5: %s)', (risePattern, label) => {
  useScheduleStore.getState().updateSelectedAlarm({ vibrationPattern: 'rise' });
  render(<ScheduleTimeline format="level" risePattern={ risePattern }/>);
  expect(screen.getByRole('button', { name: new RegExp(`^Vibrate: ${label},`) })).toBeInTheDocument();
});
