import moment from 'moment-timezone';
import type { DayOfWeek, SideSchedule } from '@api/schedulesSchema';

type BedSchedule = Partial<Record<DayOfWeek, Pick<SideSchedule['monday'], 'power' | 'temperatures'>>>;
type BedEvent = { at: moment.Moment; kind: 'on' | 'off' | 'temperature'; temperature?: number };

export function nextBedEvent(schedule: BedSchedule, timeZone: string, now = moment.tz(timeZone), kind?: 'on' | 'off'): BedEvent | undefined {
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
