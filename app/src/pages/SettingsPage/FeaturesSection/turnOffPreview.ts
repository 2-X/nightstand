import moment from 'moment-timezone';
import type { Schedules } from '@api/schedulesSchema';
import type { Settings } from '@api/settingsSchema';
import type { HandoffReport, ResolvedSleepResponse } from '@api/rhythmsResponse';
import { isAlarmPaused, isSchedulePaused, pauseEndsAt } from '@api/schedulePause';
import { nextBedEvent, weeklyAlarmInstants } from '../../ControlTempPage/bedEvents';
import { currentSleep, isEveningSleep } from '../../ControlTempPage/sleepEvents';

type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];
const HOUR_MS = 60 * 60 * 1000;

export type SidePreview = {
  side: Side;
  name: string;
  on: boolean;
  away: boolean;
  // Away with the other side present: this side follows that side's schedule.
  follows?: string;
  nextOn?: { at: moment.Moment; off?: moment.Moment; temperature?: number };
  nextOff?: moment.Moment;
  inSleepUntil?: moment.Moment;
  // The sleep in progress started in the evening, so it is "tonight's".
  eveningSleep: boolean;
  weeklyCoversNow: boolean;
  rhythmAlarms: moment.Moment[];
  // Alarms of the sleep in progress that the Pod still rings if the side is kept on.
  sleepAlarms: moment.Moment[];
  // The rest of that sleep's alarms, which a pause or an alarm override silences.
  silencedAlarms: Array<{ at: moment.Moment; reason: 'paused' | 'skipped' }>;
  weeklyAlarms: moment.Moment[];
  // Weekly alarms the Pod skips because this sleep's alarm already rang.
  skippedWeeklyAlarms: moment.Moment[];
  paused: boolean;
};

const sideName = (settings: Settings, side: Side) => settings[side].name || (side === 'left' ? 'Left side' : 'Right side');
const when = (value: moment.Moment) => value.format('ddd h:mm A');
const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');

// As the Pod does: an away side follows the present side, and two away sides run nothing.
function drivingSide(settings: Settings, side: Side): Side | null {
  if (!settings[side].awayMode) return side;
  return settings[otherSide(side)].awayMode ? null : otherSide(side);
}

export function turnOffWindow(now: Date) {
  return { from: new Date(now.getTime() - 18 * HOUR_MS).toISOString(), to: new Date(now.getTime() + 48 * HOUR_MS).toISOString() };
}

// An alarm override from the Bed page skips weekly alarms until it expires and rings its replacement time instead.
function withAlarmOverride(instants: number[], override: Settings['left']['scheduleOverrides']['alarm'], at: moment.Moment): number[] {
  const until = override.expiresAt ? moment(override.expiresAt) : undefined;
  if (!until?.isValid() || !until.isAfter(at)) return instants;
  const kept = instants.filter(instant => instant > until.valueOf());
  if (override.disabled || !override.timeOverride) return kept;
  const [hour, minute] = override.timeOverride.split(':').map(Number);
  const replacement = at.clone().hour(hour).minute(minute).second(0).millisecond(0);
  if (!replacement.isAfter(at)) replacement.add(1, 'day');
  return replacement.isAfter(until) ? kept : [replacement.valueOf(), ...kept].sort((first, second) => first - second);
}

export function turnOffPreview({ settings, schedules, sleeps, now, isOn = {} }: {
  settings: Settings; schedules: Schedules; sleeps: Record<Side, ResolvedSleepResponse[]>; now: Date;
  // Unknown reads as on, as the Pod treats a side it cannot read.
  isOn?: Partial<Record<Side, boolean>>;
}): SidePreview[] {
  const { timeZone } = settings;
  const at = moment.tz(now, timeZone);
  const horizon = at.clone().add(48, 'hours');
  return SIDES.map(side => {
    const driver = drivingSide(settings, side);
    const on = isOn[side] ?? true;
    const weeklySchedule = driver ? schedules[driver] : undefined;
    // The handoff picks the weekly night without regard to a pause, so coverage does too.
    const coverOn = weeklySchedule && nextBedEvent(weeklySchedule, timeZone, at, 'on');
    const nextOff = weeklySchedule && nextBedEvent(weeklySchedule, timeZone, at, 'off');
    // A pause then skips the weekly starts and alarms until it ends.
    const paused = !!driver && isSchedulePaused(settings, driver, now);
    const pauseEnd = paused && driver ? pauseEndsAt(settings, driver) : null;
    const schedule = !paused || pauseEnd ? weeklySchedule : undefined;
    const nextOn = schedule && (pauseEnd ? nextBedEvent(schedule, timeZone, moment.tz(pauseEnd.getTime() - 1, timeZone), 'on') : coverOn);
    // The Pod keeps nothing running for a side that is off.
    const sleep = on ? currentSleep(sleeps[side], now) : undefined;
    // Alarms ring only on a present side with alarms on.
    const ringsAlarms = driver === side && settings[side].alarmsEnabled !== false;
    const weeklyInstants = schedule && ringsAlarms
      ? withAlarmOverride(weeklyAlarmInstants(schedule, timeZone, at, horizon), settings[side].scheduleOverrides.alarm, at)
        .filter(instant => !pauseEnd || instant > pauseEnd.getTime()).sort((first, second) => first - second)
      : [];
    const rhythmAlarms = sleeps[side]
      .flatMap(item => item.events.flatMap(event => event.kind === 'alarm' && event.alarm.enabled ? [moment.tz(event.at, timeZone)] : []))
      .filter(alarmAt => alarmAt.isAfter(at) && alarmAt.isSameOrBefore(horizon))
      .sort((first, second) => first.valueOf() - second.valueOf());
    // As the Pod's alarm gates: a pause silences an alarm due by its end, and an override that is still
    // active when the alarm is due, or expired inside this sleep, skips the sleep's alarms.
    const override = settings[side].scheduleOverrides.alarm.expiresAt;
    const overrideEnds = override ? moment(override) : undefined;
    const overrideSkips = (alarmAt: moment.Moment, start: string, end: string) => !!overrideEnds?.isValid()
      && (overrideEnds.isAfter(alarmAt) || (overrideEnds.isAfter(start) && overrideEnds.isSameOrBefore(end)));
    const sleepGates = !sleep ? [] : rhythmAlarms.filter(alarmAt => alarmAt.isSameOrBefore(sleep.end)).map(alarmAt => ({
      at: alarmAt,
      reason: isAlarmPaused(settings, side, alarmAt.toDate()) ? 'paused' as const
        : overrideSkips(alarmAt, sleep.start, sleep.end) ? 'skipped' as const : undefined,
    }));
    const sleepAlarms = sleepGates.flatMap(item => item.reason ? [] : [item.at]);
    const silencedAlarms = sleepGates.flatMap(({ at: alarmAt, reason }) => reason ? [{ at: alarmAt, reason }] : []);
    // As the Pod does: during a Smart Schedule pre-warm, a weekly night that starts by the bedtime takes over.
    const bedtime = sleep?.smartCurve && at.isBefore(sleep.smartCurve.bedtime) ? moment.tz(sleep.smartCurve.bedtime, timeZone) : undefined;
    const weeklyCoversNow = !!nextOff && (!coverOn || nextOff.at.isBefore(coverOn.at) || (!!bedtime && coverOn.at.isSameOrBefore(bedtime)));
    // The Pod switches off the rest of that weekly night's alarms once this sleep's alarm rang.
    const overrideActive = !!overrideEnds?.isValid() && overrideEnds.isAfter(at);
    const rang = !!sleep && weeklyCoversNow && driver === side && !overrideActive
      && sleep.events.some(event => event.kind === 'alarm' && Date.parse(event.at) <= now.getTime());
    const skippedWeeklyAlarms = rang && nextOff
      ? weeklyInstants.filter(instant => instant <= nextOff.at.valueOf()).map(instant => moment.tz(instant, timeZone)) : [];
    return {
      side,
      name: sideName(settings, side),
      on,
      away: settings[side].awayMode,
      follows: driver && driver !== side ? sideName(settings, driver) : undefined,
      nextOn: nextOn && schedule
        && { at: nextOn.at, off: nextBedEvent(schedule, timeZone, nextOn.at, 'off')?.at, temperature: nextOn.temperature },
      nextOff: nextOff?.at,
      inSleepUntil: sleep ? moment.tz(sleep.end, timeZone) : undefined,
      eveningSleep: !!sleep && isEveningSleep(sleep, timeZone),
      weeklyCoversNow,
      rhythmAlarms,
      sleepAlarms,
      silencedAlarms,
      weeklyAlarms: weeklyInstants.map(instant => moment.tz(instant, timeZone)),
      skippedWeeklyAlarms,
      paused,
    };
  });
}

// Sides the server keeps on until their sleep ends unless the person turns them off now.
export const runningSides = (previews: SidePreview[]) => previews.filter(side => side.inSleepUntil && !side.weeklyCoversNow);

// Alarms of the sleep a side keeps running still ring; the rest of the line is what the weekly schedule does after.
const keptAlarms = (preview: SidePreview, keepOn: boolean) => keepOn && preview.inSleepUntil && !preview.weeklyCoversNow
  ? preview.sleepAlarms : [];

// One line about the next alarm, which is what people check before turning Rhythms off.
export function alarmLine(preview: SidePreview, keepOn = true): string {
  const kept = keptAlarms(preview, keepOn);
  // A side that is off, or turned off now, rings no weekly alarm before its next weekly start.
  const offNow = !preview.on || (!keepOn && !!preview.inSleepUntil);
  const startsAt = preview.nextOn?.at;
  // Turning off now also cancels the skip, which the Pod sets only for a side it hands to the weekly schedule.
  const skipped = keepOn ? preview.skippedWeeklyAlarms : [];
  const weekly = preview.weeklyAlarms.find(item => !kept.some(alarmAt => alarmAt.isSame(item, 'minute'))
    && !skipped.some(alarmAt => alarmAt.isSame(item))
    && !(offNow && (!startsAt || item.isBefore(startsAt))));
  const rhythm = preview.rhythmAlarms.find(item => !kept.some(alarmAt => alarmAt.isSame(item)));
  if (kept.length) {
    const ringing = `Alarm: ${kept.map(when).join(' and ')} still rings`;
    if (weekly) {
      return rhythm?.isSame(weekly, 'minute') ? `${ringing}. After that, the weekly alarm at ${when(weekly)}, as now.`
        : rhythm ? `${ringing}. After that, the weekly alarm at ${when(weekly)} rings instead of ${when(rhythm)}.`
          : `${ringing}. After that, the weekly alarm at ${when(weekly)}.`;
    }
    return rhythm ? `${ringing}. The rhythm alarm at ${when(rhythm)} will not ring.` : `${ringing}.`;
  }
  const silenced = keepOn && preview.inSleepUntil && !preview.weeklyCoversNow ? preview.silencedAlarms : [];
  if (silenced.length) {
    const said = (['paused', 'skipped'] as const).flatMap(reason => {
      const times = silenced.filter(item => item.reason === reason).map(item => when(item.at));
      return times.length ? [`Its ${times.join(' and ')} ${times.length > 1 ? 'alarms are' : 'alarm is'} ${reason}.`] : [];
    }).join(' ');
    return weekly ? `${said} Next alarm: the weekly alarm at ${when(weekly)}.` : `${said} No other alarm in the next 2 days.`;
  }
  if (skipped.length) {
    const lead = `The weekly alarm at ${skipped.map(when).join(' and ')} is skipped, since this sleep's alarm already rang. `;
    return weekly ? `${lead}Next alarm: the weekly alarm at ${when(weekly)}.` : `${lead}No other alarm in the next 2 days.`;
  }
  if (!weekly) {
    return rhythm ? `No alarm in the next 2 days. The rhythm alarm at ${when(rhythm)} will not ring.` : 'No alarm in the next 2 days.';
  }
  if (rhythm?.isSame(weekly, 'minute')) return `Alarm: ${when(weekly)}, as now.`;
  return rhythm ? `Alarm: the weekly alarm at ${when(weekly)} rings instead of ${when(rhythm)}.` : `Alarm: the weekly alarm at ${when(weekly)}.`;
}

// Short lines per side, such as "Tonight: weekly schedule, 9:30 PM to 7:00 AM".
export function previewLines(preview: SidePreview, now: moment.Moment, keepOn = true): string[] {
  const clock = (value: moment.Moment) => value.format('h:mm A');
  const night = (value: moment.Moment) => value.isSame(now, 'day') ? value.hour() >= 17 ? 'Tonight' : 'Today'
    : value.isSame(now.clone().add(1, 'day'), 'day') ? 'Tomorrow' : value.format('ddd');
  const lines: string[] = [];
  const { nextOn, nextOff } = preview;
  if (preview.follows) lines.push(`Away mode is on, so this side follows ${preview.follows}'s schedule.`);
  // A side turned off now has no "Now" line; the choice above says so.
  const turnedOff = !keepOn && !!preview.inSleepUntil;
  if (preview.on && !turnedOff) {
    if (preview.weeklyCoversNow && nextOff) lines.push(`Now: weekly schedule until ${clock(nextOff)}.`);
    else if (preview.inSleepUntil) {
      // The Pod keeps only the power and the remaining alarms; later temperature changes are dropped.
      const alarms = preview.sleepAlarms.length;
      lines.push(`Stays on at its current temperature until ${clock(preview.inSleepUntil)}`
        + `${alarms ? `, and its ${alarms > 1 ? 'alarms still ring' : 'alarm still rings'}` : ''}.`
        + ` The rest of ${preview.eveningSleep ? 'tonight\'s' : 'this sleep\'s'} plan stops.`);
    }
  }
  if (nextOn) lines.push(`${night(nextOn.at)}: weekly schedule, ${clock(nextOn.at)}${nextOn.off ? ` to ${clock(nextOn.off)}` : ''}.`);
  if (!nextOn && !nextOff) {
    // With both sides away the Pod runs no schedule at all.
    lines.push(preview.away && !preview.follows ? 'No upcoming power or temperature changes.'
      : 'The weekly schedule has no nights in the next week.');
  }
  lines.push(alarmLine(preview, keepOn));
  return lines;
}

// The keep-on choice names the sleep's remaining alarms, which still ring.
export function keepOnLabel(preview: SidePreview): string {
  const until = preview.inSleepUntil;
  if (!until) return '';
  const remaining = preview.sleepAlarms;
  return `Keep ${preview.name}'s side on until ${until.format('h:mm A')}`
    + (remaining.length ? ` (its ${remaining.map(item => item.format('h:mm A')).join(' and ')} alarm still rings)` : '');
}

export function handoffSummary(report: HandoffReport, settings: Settings): string {
  if (report.sides.length && report.sides.every(entry => !entry.deviceUpdateFailed && ['legacy-takes-over', 'none'].includes(entry.action))) {
    return 'Rhythms is off. The weekly schedule is back for both sides.';
  }
  const lines = report.sides.flatMap(entry => {
    const name = sideName(settings, entry.side);
    // The flag is off either way; the Pod just did not take this side's device write.
    const failed = entry.deviceUpdateFailed ? [`Could not reach the Pod, so ${name} was not changed.`] : [];
    if (entry.action === 'legacy-takes-over') return [`${name}: the weekly schedule takes over.`, ...failed];
    if (entry.action === 'kept-on-until' && entry.until) {
      return [`${name}: stays on until ${moment.tz(entry.until, settings.timeZone).format('h:mm A')}.`, ...failed];
    }
    if (entry.action === 'powered-off') return failed.length ? failed : [`${name}: turned off.`];
    return failed;
  });
  return ['Rhythms is off.', ...lines].join(' ');
}

export const handoffFailed = (report: HandoffReport) => report.sides.some(entry => !!entry.deviceUpdateFailed);
