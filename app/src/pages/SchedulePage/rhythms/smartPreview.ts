import moment from 'moment-timezone';
import type { DailySchedule } from '@api/schedulesSchema';
import type { SmartSchedule } from '@api/rhythmsSchema';
import { rhythmSleepBounds } from '@api/rhythmTimes';
import { buildCurve, levelAt, warmsBeforeBedtime, type CurvePoint } from '@api/smartCurve';

export const COOL_DOWN_MAX_DELAY_MS = 2 * 60 * 60 * 1000;

// Place a night's clock times on the date its sleep starts, in the Pod timezone. The wake time is the rhythm's own.
export function nightAnchors(night: DailySchedule, wake: string, date: string, timeZone: string) {
  const { start: bedtime, end: powerOff, scheduledWake, wake: wakeAt } = rhythmSleepBounds(date, night.power, wake, timeZone);
  return { bedtime, wake: wakeAt, powerOff, scheduledWake };
}

export function previewCurves({ night, wake, smart, date, timeZone, trackingOn }: {
  night: DailySchedule; wake: string; smart: SmartSchedule; date: string; timeZone: string; trackingOn: boolean;
}) {
  const anchors = nightAnchors(night, wake, date, timeZone);
  const input = { smart, bedtime: anchors.bedtime, coolStart: anchors.bedtime, wake: anchors.wake, powerOff: anchors.powerOff, timeZone };
  const points = anchors.powerOff > anchors.bedtime ? buildCurve(input) : [];
  // Display endpoints never become temperature commands.
  const series = points.map(({ at, level }) => ({ at, level }));
  const endLevel = levelAt(points, anchors.powerOff);
  if (endLevel !== null) series.push({ at: anchors.powerOff, level: endLevel });
  const domain = {
    from: new Date(Math.min((series[0]?.at ?? anchors.bedtime).getTime(), anchors.scheduledWake.getTime())),
    to: new Date(Math.max(anchors.scheduledWake.getTime(), anchors.powerOff.getTime())),
  };
  const markers = { bedtime: anchors.bedtime, wake: anchors.scheduledWake };
  const model = { anchors, points, series, domain, markers };
  if (!trackingOn) return { ...model, band: undefined };
  const latestStart = new Date(Math.min(anchors.bedtime.getTime() + COOL_DOWN_MAX_DELAY_MS, anchors.wake.getTime()));
  const late = buildCurve({ ...input, coolStart: latestStart });
  const from = points.find(point => point.phase === 'cooldown')?.at ?? anchors.bedtime;
  const to = late.find(point => point.phase === 'hold')?.at ?? latestStart;
  return { ...model, band: to > from ? { from, to } : undefined };
}

// "+1 at bedtime, -3 overnight, +1 at wake-up": the levels the preview chart does not label.
export function curveSummary(points: CurvePoint[], label: (level: number) => string, anchors: ReturnType<typeof nightAnchors>): string {
  const bedtime = levelAt(points, anchors.bedtime);
  const wake = levelAt(points, anchors.wake);
  if (bedtime === null) return '';
  const asleep = points.filter(point => point.phase === 'cooldown' || point.phase === 'hold').map(point => point.level);
  const overnight = asleep.length ? Math.min(...asleep) : bedtime;
  const parts = [`${label(bedtime)} at bedtime`, `${label(overnight)} overnight`];
  if (wake !== null) parts.push(`${label(wake)} at wake-up`);
  return parts.join(', ');
}

// The line under Bedtime: "Starts warming" only when the pre-warm is above neutral.
export function bedtimeNote(points: CurvePoint[], timeZone: string): string | undefined {
  const first = points[0];
  if (!first) return undefined;
  const time = moment.tz(first.at, timeZone).format('h:mm A');
  return warmsBeforeBedtime(points) ? `The bed starts warming at ${time}.` : `The bed turns on at ${time}.`;
}
