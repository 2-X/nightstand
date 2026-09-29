import _ from 'lodash';
import { create } from 'zustand';
import { AlarmSchedule, DailySchedule, DayOfWeek, Schedules, MAX_ALARMS_PER_DAY } from '@api/schedulesSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { AccordionExpanded } from './SchedulePage.types.ts';
import { DaysSelected } from './SchedulePage.types.ts';
import { useAppStore } from '@state/appStore.tsx';
import { LOWERCASE_DAYS } from './days';
import { scheduleIsValid } from './scheduleValidation';



export const DEFAULT_DAYS_SELECTED: DaysSelected = {
  sunday: false,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
};

type ScheduleStore = {
  selectedDay: DayOfWeek;
  selectedDayIndex: number;
  selectDay: (selectedDayIndex: number) => void;
  reloadScheduleData: () => void;

  changesPresent: boolean,
  checkForChanges: () => void;
  setAccordionExpanded: (accordion: AccordionExpanded) => void;
  accordionExpanded: AccordionExpanded;

  isValid: () => boolean;

  selectedSchedule: DailySchedule | undefined;
  updateSelectedSchedule: (dailySchedule: DeepPartial<DailySchedule>) => void;
  updateSelectedTemperatures: (temperatures: DailySchedule['temperatures']) => void;

  // Multi-alarm editing. The alarms array is the source of truth; the legacy
  // single `alarm` field mirrors alarms[0] so older consumers keep working.
  selectedAlarmIndex: number;
  selectAlarm: (index: number) => void;
  getEditedAlarms: () => AlarmSchedule[];
  updateSelectedAlarm: (alarm: DeepPartial<AlarmSchedule>) => void;
  addAlarm: () => void;
  removeAlarm: (index: number) => void;

  // Keep a copy of the original schedules
  originalSchedules: Schedules | undefined;
  setOriginalSchedules: (originalSchedules: Schedules) => void;

  selectedDays: Record<DayOfWeek, boolean>;
  toggleSelectedDay: (day: DayOfWeek) => void;
};

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  selectedDay: 'sunday',
  selectedDayIndex: 0,
  selectedSchedule: undefined,

  reloadScheduleData: () => {
    const { side } = useAppStore.getState();
    const { originalSchedules, selectedDay } = get();
    if (!originalSchedules) return;
    const selectedSchedule = originalSchedules[side]?.[selectedDay];

    set({
      selectedDays: { ...DEFAULT_DAYS_SELECTED },
      accordionExpanded: undefined,
      selectedSchedule,
      selectedAlarmIndex: 0,
      changesPresent: false,
    });
  },

  selectDay: (newSelectedDayIndex) => {
    const { originalSchedules, reloadScheduleData } = get();
    if (!originalSchedules) return;
    const selectedDay = LOWERCASE_DAYS[newSelectedDayIndex];
    set({ selectedDay, selectedDayIndex: newSelectedDayIndex });
    reloadScheduleData();
  },

  accordionExpanded: undefined,
  setAccordionExpanded: (accordionExpanded) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    get().accordionExpanded === accordionExpanded ? set({ accordionExpanded: undefined }) : set({ accordionExpanded });
  },

  isValid: () => {
    const { selectedSchedule, originalSchedules, selectedDay, selectedDays } = get();
    const { side } = useAppStore.getState();
    const days = [selectedDay, ...LOWERCASE_DAYS.filter(day => selectedDays[day])];
    return days.every(day => scheduleIsValid(selectedSchedule, originalSchedules?.[side]?.[day]?.alarms?.length ?? 0));
  },
  changesPresent: false,
  checkForChanges: () => {
    const { selectedDay, selectedSchedule, originalSchedules, selectedDays } = get();
    if (!originalSchedules) return;
    const { side } = useAppStore.getState();
    // Editing an alarm rewrites a legacy day's empty `alarms: []` into
    // `[alarm]`, so a raw comparison would flag a phantom change (and could
    // never clear). Compare the effective alarm list on both sides instead.
    const normalizeAlarms = (schedule: DailySchedule | undefined) => {
      if (!schedule) return schedule;
      const alarms = (schedule.alarms ?? []).length > 0
        ? schedule.alarms
        : (schedule.alarm ? [schedule.alarm] : []);
      return { ...schedule, alarms, alarm: alarms[0] };
    };
    const changesPresent = !_.isEqual(
      normalizeAlarms(originalSchedules[side]?.[selectedDay]),
      normalizeAlarms(selectedSchedule),
    ) || _.some(selectedDays, value => value === true);

    set({ changesPresent });
  },

  // Updating schedules
  updateSelectedSchedule: (newSelectedSchedule) => {
    const { selectedSchedule, checkForChanges } = get();
    const selectedScheduleCopy = _.cloneDeep(selectedSchedule ?? {
      power: { enabled: true, on: '21:00', off: '07:30', onTemperature: 83 },
      temperatures: {},
      alarm: { enabled: true, time: '07:00', vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 10, alarmTemperature: 83 },
      alarms: [],
    });
    _.merge(selectedScheduleCopy, newSelectedSchedule);

    set({ selectedSchedule: selectedScheduleCopy });
    checkForChanges();
  },
  selectedAlarmIndex: 0,
  selectAlarm: (index) => set({ selectedAlarmIndex: index }),
  // The alarms array drives the editor. A day saved before multi-alarm
  // support has an empty array, so seed the editor from the legacy alarm.
  getEditedAlarms: () => {
    const { selectedSchedule } = get();
    if (!selectedSchedule) return [];
    if ((selectedSchedule.alarms ?? []).length > 0) return selectedSchedule.alarms;
    return [selectedSchedule.alarm];
  },
  updateSelectedAlarm: (alarmUpdate) => {
    const { selectedSchedule, selectedAlarmIndex, getEditedAlarms, checkForChanges } = get();
    if (!selectedSchedule) return;
    const alarms = _.cloneDeep(getEditedAlarms());
    if (!alarms[selectedAlarmIndex]) return;
    _.merge(alarms[selectedAlarmIndex], alarmUpdate);
    set({
      selectedSchedule: {
        ..._.cloneDeep(selectedSchedule),
        alarms,
        alarm: alarms[0],
      },
    });
    checkForChanges();
  },
  addAlarm: () => {
    const { selectedSchedule, getEditedAlarms, checkForChanges } = get();
    if (!selectedSchedule) return;
    const alarms = _.cloneDeep(getEditedAlarms());
    if (alarms.length >= MAX_ALARMS_PER_DAY) return;
    alarms.push({ ...alarms[alarms.length - 1], enabled: true });
    set({
      selectedSchedule: {
        ..._.cloneDeep(selectedSchedule),
        alarms,
        alarm: alarms[0],
      },
      selectedAlarmIndex: alarms.length - 1,
    });
    checkForChanges();
  },
  removeAlarm: (index) => {
    const { selectedSchedule, selectedAlarmIndex, getEditedAlarms, checkForChanges } = get();
    if (!selectedSchedule) return;
    const alarms = _.cloneDeep(getEditedAlarms());
    if (alarms.length <= 1) return;
    alarms.splice(index, 1);
    set({
      selectedSchedule: {
        ..._.cloneDeep(selectedSchedule),
        alarms,
        alarm: alarms[0],
      },
      selectedAlarmIndex: Math.min(selectedAlarmIndex, alarms.length - 1),
    });
    checkForChanges();
  },
  // Updating schedules - (Temperatures) - needs to replace the entire temperatures field instead of merging it
  updateSelectedTemperatures: (temperatures) => {
    const { selectedSchedule, checkForChanges } = get();
    const selectedScheduleCopy = _.cloneDeep(selectedSchedule);
    if (!selectedSchedule) return;
    set({
      // @ts-ignore
      selectedSchedule: {
        ...selectedScheduleCopy,
        temperatures,
      },
    });
    checkForChanges();
  },

  selectedDays: { ...DEFAULT_DAYS_SELECTED },
  toggleSelectedDay: (day) => {
    const { selectedDays, checkForChanges } = get();
    set({
      selectedDays: {
        ...selectedDays,
        [day]: !selectedDays[day],
      }
    });
    checkForChanges();
  },

  originalSchedules: undefined,
  setOriginalSchedules: (originalSchedules) => {
    const { side } = useAppStore.getState();
    const { selectedDay } = get();
    const selectedSchedule = _.cloneDeep(originalSchedules[side]?.[selectedDay]);

    set({ originalSchedules, selectedSchedule });
  },
}));
