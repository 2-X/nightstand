// Shared by server and app: no node-only imports.
import type { DailySchedule } from './schedulesSchema.js';

const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Minutes from power on to a clock time, wrapping past midnight.
export const minutesAfterOn = (time: string, on: string) => (minuteOf(time) - minuteOf(on) + 1440) % 1440;

const nightMinutes = (power: DailySchedule['power']) => (power.off === power.on ? 1440 : minutesAfterOn(power.off, power.on));

// Same rule as the app's timeInPowerWindow: from power on up to power off.
export function wakeInNight(wake: string, power: DailySchedule['power']): boolean {
  return minutesAfterOn(wake, power.on) <= nightMinutes(power);
}

// The wake time a weekly night implies: its earliest enabled alarm inside the night, else its turn off.
export function wakeFromNight(night: DailySchedule): string {
  const { power } = night;
  const alarms = (night.alarms.length ? night.alarms : [night.alarm])
    .filter(alarm => alarm.enabled && minutesAfterOn(alarm.time, power.on) > 0 && wakeInNight(alarm.time, power))
    .sort((a, b) => minutesAfterOn(a.time, power.on) - minutesAfterOn(b.time, power.on));
  return alarms[0]?.time ?? power.off;
}
