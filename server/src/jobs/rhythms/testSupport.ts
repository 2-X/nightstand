import type { AlarmSchedule, DailySchedule, Schedules, Time } from '../../db/schedulesSchema.js';
import { DEFAULT_SMART, RHYTHMS_FILE_VERSION, type RhythmsDB, type SideRhythms } from '../../db/rhythmsSchema.js';
import { wakeFromNight } from '../../db/rhythmWake.js';
import { SCHEDULE_DAYS } from '../../db/scheduleKeys.js';
import { legacyFingerprint } from './fingerprint.js';

const TEST_ALARM: AlarmSchedule = {
  time: '07:00', enabled: true, vibrationIntensity: 60, vibrationPattern: 'rise', duration: 20, alarmTemperature: 82,
};

export type NightOptions = {
  temperatures?: Record<string, number>;
  alarms?: string[];
  onTemperature?: number;
  enabled?: boolean;
  alarmIntensity?: number;
};

export function testNight(on: Time, off: Time, options: NightOptions = {}): DailySchedule {
  const alarms = (options.alarms ?? []).map(time => ({
    ...TEST_ALARM, time, vibrationIntensity: options.alarmIntensity ?? TEST_ALARM.vibrationIntensity,
  }));
  return {
    power: { on, off, enabled: options.enabled ?? true, onTemperature: options.onTemperature ?? 80 },
    temperatures: { ...(options.temperatures ?? {}) },
    alarm: alarms[0] ?? { ...TEST_ALARM, time: off, enabled: false },
    alarms,
  };
}

export function everyNight(night: DailySchedule | null, id = 'every-night'): SideRhythms {
  return {
    rhythms: night ? {
      [id]: { id, name: 'Every night', night, wake: wakeFromNight(night), temperatureMode: 'manual', smart: { ...DEFAULT_SMART } },
    } : {},
    week: Object.fromEntries(SCHEDULE_DAYS.map(day => [day, night ? id : null])) as SideRhythms['week'],
    changes: [],
  };
}

export function testRhythmsDB(schedules: Schedules, left: SideRhythms, right: SideRhythms = everyNight(null)): RhythmsDB {
  return { version: RHYTHMS_FILE_VERSION, legacyFingerprint: legacyFingerprint(schedules), left, right };
}
