import { beforeEach, expect, it } from 'vitest';
import { useAppStore } from '@state/appStore';
import { getSchedules } from '../../mocks/mockData';
import { useScheduleStore } from './scheduleStore';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});

it('compares edits against a rhythm night and resets to it', () => {
  const night = structuredClone(getSchedules().left.monday);
  useScheduleStore.getState().editNight(night);
  expect(useScheduleStore.getState().changesPresent).toBe(false);
  useScheduleStore.getState().updateSelectedSchedule({ power: { on: '22:00' } });
  expect(useScheduleStore.getState().changesPresent).toBe(true);
  useScheduleStore.getState().reloadScheduleData();
  expect(useScheduleStore.getState().selectedSchedule?.power.on).toBe(night.power.on);
  expect(useScheduleStore.getState().changesPresent).toBe(false);
});

it('validates against the rhythm night', () => {
  useScheduleStore.getState().editNight(structuredClone(getSchedules().left.monday));
  expect(useScheduleStore.getState().isValid()).toBe(true);
  useScheduleStore.getState().updateSelectedSchedule({ power: { onTemperature: 111 } });
  expect(useScheduleStore.getState().isValid()).toBe(false);
});

it('never adds a second alarm in a minute that already has one on a rhythm night', () => {
  const night = structuredClone(getSchedules().left.monday);
  night.power = { ...night.power, enabled: true, on: '21:00', off: '07:00' };
  night.alarm = { ...night.alarm, enabled: true, time: '07:00' };
  night.alarms = [night.alarm];
  useScheduleStore.getState().editNight(night);
  useScheduleStore.getState().addAlarm();
  expect(useScheduleStore.getState().getEditedAlarms().map(alarm => alarm.time)).toEqual(['07:00', '06:59']);
  expect(useScheduleStore.getState().isValid()).toBe(true);
});

it('hands weekly editing back untouched after the rhythm editor closes', () => {
  useScheduleStore.getState().editNight(structuredClone(getSchedules().left.friday));
  useScheduleStore.getState().endNightEdit();
  expect(useScheduleStore.getState().nightBaseline).toBeUndefined();
  expect(useScheduleStore.getState().selectedSchedule).toBeUndefined();
  useScheduleStore.getState().setOriginalSchedules(structuredClone(getSchedules()));
  useScheduleStore.getState().selectDay(1);
  expect(useScheduleStore.getState().selectedSchedule).toEqual(getSchedules().left.monday);
  useScheduleStore.getState().updateSelectedSchedule({ power: { on: '20:00' } });
  expect(useScheduleStore.getState().changesPresent).toBe(true);
});
