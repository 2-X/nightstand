import moment from 'moment-timezone';
import type { DayOfWeek, SideSchedule } from '@api/schedulesSchema';
import type { Skip } from './sleepEvents';

export type BedSchedule = Partial<Record<DayOfWeek, Pick<SideSchedule['monday'], 'power' | 'temperatures'>>>;
type BedEvent = { at: moment.Moment; kind: 'on' | 'off' | 'temperature'; temperature?: number };

export function nextBedEvent(schedule: BedSchedule, timeZone: string, now = moment.tz(timeZone), kind?: 'on' | 'off'): BedEvent | undefined {
  // The Pod schedules nothing without a time zone, so there is nothing to announce.
  if (!timeZone) return undefined;
  const events: BedEvent[] = [];
  for (let offset = -1; offset < 8; offset++) {
    const date = now.clone().tz(timeZone).startOf('day').add(offset, 'days');
    const daily = schedule[date.format('dddd').toLowerCase() as DayOfWeek];
    if (!daily?.power.enabled) continue;
    const at = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      const result = date.clone().hour(h).minute(m);
      if (time < daily.power.on) result.add(1, 'day');
      return result;
    };
    events.push({ at: at(daily.power.on), kind: 'on', temperature: daily.power.onTemperature });
    const off = at(daily.power.off);
    if (daily.power.off === daily.power.on) off.add(1, 'day');
    events.push({ at: off, kind: 'off' });
    for (const [time, temperature] of Object.entries(daily.temperatures))
      events.push({ at: at(time), kind: 'temperature', temperature });
  }
  return events.filter((event) => event.at.isAfter(now) && (!kind || event.kind === kind)).sort((a, b) => a.at.valueOf() - b.at.valueOf())[0];
}

// Enabled weekly alarms between two instants, as epoch milliseconds.
export function weeklyAlarmInstants(schedule: Partial<SideSchedule>, timeZone: string, from: moment.Moment, to: moment.Moment): number[] {
  const instants: number[] = [];
  const days = Math.ceil(to.diff(from, 'days', true)) + 1;
  for (let offset = -1; offset <= days; offset++) {
    const date = from.clone().tz(timeZone).startOf('day').add(offset, 'days');
    const daily = schedule[date.format('dddd').toLowerCase() as DayOfWeek];
    if (!daily?.power.enabled) continue;
    // A schedule read without alarms (an older shape) has none to list.
    for (const alarm of daily.alarms?.length ? daily.alarms : daily.alarm ? [daily.alarm] : []) {
      if (!alarm.enabled) continue;
      const [hour, minute] = alarm.time.split(':').map(Number);
      const at = date.clone().hour(hour).minute(minute).second(0).millisecond(0);
      if (alarm.time < daily.power.on) at.add(1, 'day');
      if (at.isSameOrAfter(from) && at.isSameOrBefore(to)) instants.push(at.valueOf());
    }
  }
  return instants;
}

// What a pause from now until `end` skips on the weekly schedule.
export function weeklySkips(schedule: Partial<SideSchedule>, timeZone: string, now: moment.Moment, end: moment.Moment): Skip[] {
  const found: Skip[] = [];
  // Only starts and turn-offs count toward the guard, so a night with many set points cannot cut the scan short.
  for (let after = now, guard = 0; guard < 60;) {
    const event = nextBedEvent(schedule, timeZone, after);
    if (!event?.at.isBefore(end)) break;
    if (event.kind !== 'temperature') guard++;
    found.push({ at: event.at, kind: event.kind === 'on' ? 'start' : event.kind === 'off' ? 'turn off' : 'temperature' });
    after = event.at;
  }
  for (const instant of weeklyAlarmInstants(schedule, timeZone, now, end)) found.push({ at: moment.tz(instant, timeZone), kind: 'alarm' });
  return found.sort((first, second) => first.at.valueOf() - second.at.valueOf());
}
