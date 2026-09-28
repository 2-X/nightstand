import { DailySchedule, DailyScheduleSchema } from '@api/schedulesSchema';

export function minutesSincePowerOn(time: string, powerOn: string): number {
  const minutes = (value: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  return (minutes(time) - minutes(powerOn) + 1440) % 1440;
}

export function timeInPowerWindow(time: string, power: DailySchedule['power']): boolean {
  const offset = minutesSincePowerOn(time, power.on);
  const end = power.off === power.on ? 1440 : minutesSincePowerOn(power.off, power.on);
  return Number.isFinite(offset) && end > 0 && offset <= end;
}

export function temperatureInPowerWindow(time: string, power: DailySchedule['power']): boolean {
  const offset = minutesSincePowerOn(time, power.on);
  const end = power.off === power.on ? 1440 : minutesSincePowerOn(power.off, power.on);
  return Number.isFinite(offset) && offset > 0 && offset < end;
}

export function scheduleIsValid(schedule: DailySchedule | undefined): boolean {
  if (!schedule || !DailyScheduleSchema.safeParse(schedule).success) return false;
  if (!schedule.power.enabled) return true;
  const alarms = schedule.alarms.length ? schedule.alarms : [schedule.alarm];
  return alarms.every(alarm => !alarm.enabled || timeInPowerWindow(alarm.time, schedule.power))
    && Object.keys(schedule.temperatures).every(time => temperatureInPowerWindow(time, schedule.power));
}
