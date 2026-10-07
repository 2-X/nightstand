import moment from 'moment-timezone';

const DATE_FORMAT = 'YYYY-MM-DD';

export const addDays = (date: string, days: number) => moment.utc(date, DATE_FORMAT, true).add(days, 'day').format(DATE_FORMAT);

// Missing times move forward by the gap; repeated times use the first occurrence.
export function wallClock(date: string, time: string, timeZone: string): Date {
  return moment.tz(`${date} ${time}`, `${DATE_FORMAT} HH:mm`, true, timeZone).toDate();
}

export function rhythmNightBounds(date: string, power: { on: string; off: string }, timeZone: string) {
  const start = wallClock(date, power.on, timeZone);
  const end = wallClock(power.off <= power.on ? addDays(date, 1) : date, power.off, timeZone);
  return { start, end };
}

// Keep wake inside the resolved sleep, including clock changes and equal on/off times.
export function rhythmSleepBounds(date: string, power: { on: string; off: string }, wakeTime: string, timeZone: string) {
  const { start, end } = rhythmNightBounds(date, power, timeZone);
  const scheduledWake = wakeTime === power.off ? end : wallClock(wakeTime < power.on ? addDays(date, 1) : date, wakeTime, timeZone);
  const wake = new Date(Math.min(Math.max(scheduledWake.getTime(), start.getTime()), end.getTime()));
  return { start, end, wake, scheduledWake };
}
