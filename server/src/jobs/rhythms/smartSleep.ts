import {
  buildCurve, effectiveCoolStart, isDaySleep, levelToF,
} from '../../db/smartCurve.js';
import type { ResolvedSleep, RhythmEvent } from './resolve.js';

const KIND_ORDER: Record<RhythmEvent['kind'], number> = {
  'power-on': 0, temperature: 1, alarm: 2, 'power-off': 3,
};

const byTimeThenKind = (a: RhythmEvent, b: RhythmEvent) =>
  a.at.getTime() - b.at.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];

// The rhythm's own wake time, with or without an alarm, held inside the sleep.
export function smartWake(sleep: ResolvedSleep): Date {
  return new Date(Math.min(Math.max(sleep.wake.getTime(), sleep.start.getTime()), sleep.end.getTime()));
}

// Replaces a smart sleep's temperatures with the curve. The power-on moves to
// the pre-warm start and carries the first curve level.
export function applySmartCurve(sleep: ResolvedSleep, timeZone: string, coolStart?: Date): ResolvedSleep {
  if (sleep.mode !== 'smart' || !sleep.smart || sleep.smartCurve) return sleep;
  const bedtime = sleep.start;
  const wake = smartWake(sleep);
  const effective = effectiveCoolStart(bedtime, coolStart ?? bedtime);
  const points = buildCurve({
    smart: sleep.smart, bedtime, coolStart: effective, wake, powerOff: sleep.end, timeZone,
  });
  const [first, ...rest] = points;
  const kept = sleep.events.filter(event => event.kind === 'alarm' || event.kind === 'power-off');
  const powerOn: RhythmEvent = { kind: 'power-on', at: first.at, temperatureF: levelToF(first.level) };
  const temperatures = rest.map((point): RhythmEvent => ({
    kind: 'temperature', at: point.at, temperatureF: levelToF(point.level),
  }));
  const events = [powerOn, ...temperatures, ...kept].sort(byTimeThenKind);
  return {
    ...sleep,
    start: first.at,
    events,
    smartCurve: { bedtime, coolStart: effective, wake, daySleep: isDaySleep(bedtime, wake, timeZone), points },
  };
}
