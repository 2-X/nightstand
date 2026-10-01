import moment from 'moment-timezone';
import type { DailySchedule } from '@api/schedulesSchema';
import type { SmartSchedule } from '@api/rhythmsSchema';
import { buildCurve, warmsBeforeBedtime, type CurvePoint } from '@api/smartCurve';

export const COOL_DOWN_MAX_DELAY_MS = 2 * 60 * 60 * 1000;

// Place a night's clock times on the date its sleep starts, in the Pod timezone. The wake time is the rhythm's own.
export function nightAnchors(night: DailySchedule, wake: string, date: string, timeZone: string) {
  const at = (time: string) => {
    const value = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', timeZone);
    if (time < night.power.on) value.add(1, 'day');
    return value;
  };
  const bedtime = at(night.power.on);
  const powerOff = at(night.power.off);
  if (night.power.off === night.power.on) powerOff.add(1, 'day');
  const wakeAt = moment.min(at(wake), powerOff);
  return { bedtime: bedtime.toDate(), wake: wakeAt.toDate(), powerOff: powerOff.toDate() };
}

export function previewCurves({ night, wake, smart, date, timeZone, trackingOn }: {
  night: DailySchedule; wake: string; smart: SmartSchedule; date: string; timeZone: string; trackingOn: boolean;
}): { anchors: ReturnType<typeof nightAnchors>; points: CurvePoint[]; band?: { from: Date; to: Date } } {
  const anchors = nightAnchors(night, wake, date, timeZone);
  const input = { smart, bedtime: anchors.bedtime, coolStart: anchors.bedtime, wake: anchors.wake, powerOff: anchors.powerOff, timeZone };
  const points = buildCurve(input);
  if (!trackingOn) return { anchors, points };
  const latestStart = new Date(Math.min(anchors.bedtime.getTime() + COOL_DOWN_MAX_DELAY_MS, anchors.wake.getTime()));
  const late = buildCurve({ ...input, coolStart: latestStart });
  const from = points.find(point => point.phase === 'cooldown')?.at ?? anchors.bedtime;
  const to = late.find(point => point.phase === 'hold')?.at ?? latestStart;
  return { anchors, points, band: to > from ? { from, to } : undefined };
}

// "+1 at bedtime, -3 overnight, +1 at wake-up": the levels the preview chart does not label.
export function curveSummary(points: CurvePoint[], label: (level: number) => string): string {
  const at = (phase: CurvePoint['phase']) => points.find(point => point.phase === phase)?.level;
  const bedtime = at('bedtime');
  const wake = at('wake');
  if (bedtime === undefined) return '';
  const asleep = points.filter(point => point.phase === 'cooldown' || point.phase === 'hold').map(point => point.level);
  const overnight = asleep.length ? Math.min(...asleep) : bedtime;
  const parts = [`${label(bedtime)} at bedtime`, `${label(overnight)} overnight`];
  if (wake !== undefined) parts.push(`${label(wake)} at wake-up`);
  return parts.join(', ');
}

// The line under Bedtime: "Starts warming" only when the pre-warm is above neutral.
export function bedtimeNote(points: CurvePoint[], timeZone: string): string | undefined {
  const first = points[0];
  if (!first) return undefined;
  const time = moment.tz(first.at, timeZone).format('h:mm A');
  return warmsBeforeBedtime(points) ? `The bed starts warming at ${time}.` : `The bed turns on at ${time}.`;
}
