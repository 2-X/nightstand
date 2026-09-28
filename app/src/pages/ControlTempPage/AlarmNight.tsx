import moment from 'moment-timezone';
import { nightBounds } from '@lib/nightBounds';
import { DayOfWeek, SideSchedule } from '@api/schedulesSchema';

// Anchor events to power-on, including the previous evening after midnight.
export function nextAlarmNight(schedule: SideSchedule, timeZone: string, now = moment.tz(timeZone), override?: { expiresAt: string }) {
  const candidates = [];
  for (let offset = -1; offset < 8; offset++) {
    const day = now.clone().startOf('day').add(offset, 'days');
    const daily = schedule[day.format('dddd').toLowerCase() as DayOfWeek];
    if (!daily?.power.enabled) continue;
    const atTime = (time: string) => {
      const [hour, minute] = time.split(':').map(Number);
      const date = day.clone().hour(hour).minute(minute);
      if (time < daily.power.on) date.add(1, 'day');
      return date;
    };
    const { start, end } = nightBounds(day, daily.power);
    if (!end.isAfter(now)) continue;
    const hasOverride = !!override?.expiresAt && moment(override.expiresAt).isBetween(start, end, undefined, '(]');
    const alarms = (daily.alarms.length ? daily.alarms : [daily.alarm])
      .filter(alarm => alarm.enabled)
      .map(alarm => ({ alarm, at: atTime(alarm.time) }))
      .filter(({ at }) => (hasOverride || at.isSameOrAfter(now)) && at.isSameOrBefore(end))
      .sort((first, second) => first.at.valueOf() - second.at.valueOf());
    if (alarms.length) candidates.push({ start, end, alarms });
  }
  return candidates.sort((first, second) => first.alarms[0].at.valueOf() - second.alarms[0].at.valueOf())[0];
}
