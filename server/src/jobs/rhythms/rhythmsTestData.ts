// Builders shared by the Rhythms tests.
import { AlarmSchedule, DailySchedule, DayOfWeek, Schedules, SideSchedule } from '../../db/schedulesSchema.js';
import { DEFAULT_SMART, DateChange, Rhythm, RhythmsDB, SideRhythms, WeekPlan } from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';

export const alarmAt = (time: string, over: Partial<AlarmSchedule> = {}): AlarmSchedule => ({
  time, enabled: true, vibrationIntensity: 80, vibrationPattern: 'rise', duration: 30, alarmTemperature: 82, ...over,
});

export const nightOf = (over: {
  on: string; off: string; enabled?: boolean; onTemperature?: number;
  temperatures?: Record<string, number>; alarms?: AlarmSchedule[];
}): DailySchedule => {
  const alarms = over.alarms ?? [];
  return {
    temperatures: over.temperatures ?? {},
    alarm: alarms[0] ?? alarmAt('07:00', { enabled: false }),
    alarms,
    power: { on: over.on, off: over.off, onTemperature: over.onTemperature ?? 82, enabled: over.enabled ?? true },
  };
};

export const OFF_NIGHT = nightOf({ on: '21:00', off: '09:00', enabled: false });

export const rhythmOf = (id: string, night: DailySchedule, over: Partial<Rhythm> = {}): Rhythm => ({
  id, name: id, night, wake: wakeFromNight(night), temperatureMode: 'manual', smart: { ...DEFAULT_SMART }, ...over,
});

export const sideOf = (rhythms: Rhythm[] = [], week: Partial<WeekPlan> = {}, changes: DateChange[] = []): SideRhythms => ({
  rhythms: Object.fromEntries(rhythms.map(rhythm => [rhythm.id, rhythm])),
  week: { sunday: null, monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, ...week },
  changes,
});

export const dbOf = (left: SideRhythms, right: SideRhythms = sideOf(), legacyFingerprint = '0'.repeat(64)): RhythmsDB => ({
  version: 1, legacyFingerprint, left, right,
});

const sideScheduleOf = (days: Partial<Record<DayOfWeek, DailySchedule>>): SideSchedule =>
  Object.fromEntries(SCHEDULE_DAYS.map(day => [day, structuredClone(days[day] ?? OFF_NIGHT)])) as SideSchedule;

export const schedulesOf = (
  left: Partial<Record<DayOfWeek, DailySchedule>> = {},
  right: Partial<Record<DayOfWeek, DailySchedule>> = {},
): Schedules => ({ left: sideScheduleOf(left), right: sideScheduleOf(right) });

export const WORKDAY = nightOf({
  on: '22:00', off: '07:00', temperatures: { '23:00': 78, '03:00': 74 }, alarms: [alarmAt('06:30')],
});
