import moment from 'moment-timezone';
import { buildCurve, type CurvePoint } from '@api/smartCurve';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import { displayTemperature, levelToFahrenheit, type TemperatureFormat } from '@lib/temperatureConversions';

export type PhaseLineInput = {
  points: CurvePoint[];
  now: Date;
  wake: Date;
  timeZone: string;
  format: TemperatureFormat;
  waiting: boolean;
  hold?: { level: number; until: Date };
  // Set once the curve went back to the base: up early, or out of bed after the wake time.
  base?: { level: number; since: Date };
};

export function smartPhaseLine(input: PhaseLineInput): string | undefined {
  const { points, now, wake, timeZone, format, waiting, hold, base } = input;
  const time = (date: Date) => moment.tz(date, timeZone).format('h:mm A');
  const temperature = (level: number) => displayTemperature(levelToFahrenheit(level), format);
  const warmUp = points.find(point => point.phase === 'warmup');
  // A manual change holds until the curve's next phase starts, at most 3 hours.
  if (hold) {
    const next = points.find(point => Math.abs(point.at.getTime() - hold.until.getTime()) < 60_000);
    const held = `Holding ${temperature(hold.level)}`;
    // While the cool-down waits for bed entry, a hold before it ends with it.
    if (waiting) return `${held} until the cool-down, which starts once you've settled in bed`;
    if (next?.phase === 'cooldown') return `${held} until the cool-down at ${time(hold.until)}`;
    if (next?.phase === 'hold') return `${held} until ${time(hold.until)}, then ${temperature(next.level)} for the night`;
    if (next?.phase === 'warmup') return `${held} until the warm-up at ${time(hold.until)}`;
    if (next?.phase === 'wake') return `${held} until your ${time(wake)} wake-up`;
    return `${held} until ${time(hold.until)}`;
  }
  if (base && base.since.getTime() <= now.getTime()) return `Back at your base, ${temperature(base.level)}, since ${time(base.since)}`;
  let current: CurvePoint | undefined;
  for (const point of points) if (point.at.getTime() <= now.getTime()) current = point;
  if (!current) return undefined;
  const nextPoint = points.find(point => point.at.getTime() > now.getTime());
  const holdPoint = points.find(point => point.phase === 'hold');
  const bedtime = points.find(point => point.phase === 'bedtime');
  switch (current.phase) {
  case 'prewarm':
    return bedtime ? `Warming to ${temperature(bedtime.level)} for bedtime at ${time(bedtime.at)}` : `Warming to ${temperature(current.level)}`;
  case 'bedtime':
  case 'cooldown':
    if (!holdPoint) return undefined;
    if (waiting) return 'Starts cooling once you\'ve settled in bed';
    // A trend, not a target: the dial shows the current step.
    return `Cooling step by step to ${temperature(holdPoint.level)} by ${time(holdPoint.at)}`;
  case 'hold':
    if (warmUp && warmUp.at.getTime() > now.getTime()) {
      return `Warm-up starts at ${time(warmUp.at)} for your ${time(wake)} wake-up`;
    }
    return `Holding ${temperature(current.level)} until ${time(wake)}`;
  case 'warmup':
    return `Warming step by step for your ${time(wake)} wake-up`;
  case 'wake':
    return nextPoint ? `Back to ${temperature(nextPoint.level)} at ${time(nextPoint.at)}` : undefined;
  default:
    return undefined;
  }
}

// night.power.on is the bedtime; the resolved start is the earlier pre-warm.
export function smartLineForSleep(
  sleep: ResolvedSleepResponse,
  { coolStart, ...options }: Omit<PhaseLineInput, 'points' | 'wake'> & { coolStart?: Date },
) {
  if (sleep.mode !== 'smart' || !sleep.smart) return undefined;
  const bedtime = sleep.smartCurve ? new Date(sleep.smartCurve.bedtime)
    : moment.tz(`${sleep.date} ${sleep.night.power.on}`, 'YYYY-MM-DD HH:mm', options.timeZone).toDate();
  const powerOff = new Date(sleep.end);
  // The rhythm's own wake time, with or without an alarm.
  const wake = new Date(sleep.smartCurve?.wake ?? sleep.wake ?? sleep.end);
  const points = buildCurve({
    smart: sleep.smart, bedtime, coolStart: coolStart ?? bedtime, wake, powerOff, timeZone: options.timeZone,
  });
  return smartPhaseLine({ ...options, points, wake });
}
