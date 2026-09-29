import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScheduleTimeline from './ScheduleTimeline';
import SaveButton from './SaveButton';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  const store = useScheduleStore.getState();
  store.setOriginalSchedules(structuredClone(getSchedules()));
  store.selectDay(0);
  store.updateSelectedSchedule({ power: { enabled: true, on: '21:00', off: '09:00' } });
  store.updateSelectedTemperatures({ '01:00': 60, '02:00': 80 });
  store.setAccordionExpanded('temperatureAdjustments');
});

it('rejects duplicate temperature times without losing either adjustment', () => {
  render(<ScheduleTimeline format="fahrenheit" />);
  fireEvent.change(screen.getAllByLabelText('Change at')[0], { target: { value: '02:00' } });
  expect(useScheduleStore.getState().selectedSchedule?.temperatures).toEqual({ '01:00': 60, '02:00': 80 });
  expect(screen.getByRole('alert')).toHaveTextContent(/already/);
});

it('blocks saving an out-of-window temperature even when its editor is closed', () => {
  useScheduleStore.getState().updateSelectedTemperatures({ '15:00': 60 });
  render(<SaveButton onSave={ () => {} } />);
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it('allows a 23:00 alarm in the 21:00 to 09:00 overnight window', () => {
  render(<ScheduleTimeline format="fahrenheit" />);
  fireEvent.change(screen.getByLabelText('Wake at'), { target: { value: '23:00' } });
  expect(useScheduleStore.getState().isValid()).toBe(true);
  expect(screen.getByLabelText('Wake at')).not.toHaveAttribute('aria-invalid', 'true');
});

it('revalidates all enabled alarms when power times change and ignores disabled alarms', () => {
  const store = useScheduleStore.getState();
  store.updateSelectedAlarm({ time: '07:00', enabled: true });
  store.addAlarm();
  store.updateSelectedAlarm({ time: '08:00' });
  store.updateSelectedSchedule({ power: { off: '07:30' } });
  store.selectAlarm(0);
  expect(store.isValid()).toBe(false);
  store.selectAlarm(1);
  store.updateSelectedAlarm({ enabled: false });
  expect(store.isValid()).toBe(true);
});

it('preserves the server full-day meaning when power on equals power off', () => {
  useScheduleStore.getState().updateSelectedSchedule({ power: { on: '21:00', off: '21:00' } });
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it.each(['21:00', '09:00'])('rejects a temperature change at power boundary %s', time => {
  useScheduleStore.getState().updateSelectedTemperatures({ [time]: 60 });
  expect(useScheduleStore.getState().isValid()).toBe(false);
});
it('keeps the adjustment input mounted and focused when its time changes', () => {
  render(<ScheduleTimeline format="fahrenheit" />);
  const input = screen.getAllByLabelText('Change at')[0];
  input.focus();
  fireEvent.change(input, { target: { value: '03:00' } });
  expect(input).toBeInTheDocument();
  expect(input).toHaveFocus();
});
it('keeps the temperature within the 21 supported levels', () => {
  useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 110 } });
  render(<ScheduleTimeline format="level" />);
  const control = screen.getByRole('spinbutton', { name: 'Bedtime temperature' });
  fireEvent.keyDown(control, { key: 'ArrowUp' });
  expect(useScheduleStore.getState().selectedSchedule?.power.onTemperature).toBe(110);
  fireEvent.keyDown(control, { key: 'ArrowDown' });
  expect(useScheduleStore.getState().selectedSchedule?.power.onTemperature).toBe(107);
});

it('focuses and scrolls a newly added temperature row into view', () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  render(<ScheduleTimeline format="fahrenheit" />);
  fireEvent.click(screen.getByRole('button', { name: 'Add temperature change' }));
  expect(screen.getByDisplayValue('05:30')).toHaveFocus();
  expect(useScheduleStore.getState().selectedSchedule?.temperatures['05:30']).toBe(80);
  expect(scroll).toHaveBeenCalled();
});

it('explains why a temperature change at power-off has no effect', () => {
  useScheduleStore.getState().updateSelectedTemperatures({ '09:00': 60 });
  render(<ScheduleTimeline format="fahrenheit" />);
  expect(screen.getByText('This change happens as the bed turns off, so it has no effect. Move it earlier or delete it.')).toBeInTheDocument();
});
