// Pure projection math for the Tonight chart: turn a side's weekly schedule
// (per-day temperature setpoints + power window) into the planned temperature
// curve for the rest of tonight.
//
// The pod holds each setpoint until the next one, so the projected curve is a
// step function. We resolve every setpoint to a concrete instant on the night's
// calendar and emit a point at each step boundary (plus one at `from` carrying
// the setpoint in effect then), so the chart can draw a dashed step line with
// curve: 'stepAfter'.

import moment from 'moment-timezone';
import type { Schedules, Side, DayOfWeek } from '@api/schedulesSchema.ts';

const DAY_KEYS: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export type ProjectedPoint = {
  // epoch ms
  ts: number;
  targetF: number;
};

// Compare two HH:mm strings as minutes-of-day.
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Resolve a setpoint HH:mm belonging to `scheduleDay` to a concrete instant.
// A setpoint at/after power.on is on scheduleDay; one before power.on belongs to
// the following calendar day (the "morning" of that night), mirroring the
// server's getDayIndexForTime.
function resolveSetpointInstant(
  scheduleDayStart: moment.Moment,
  hhmm: string,
  powerOn: string,
): moment.Moment {
  const [h, m] = hhmm.split(':').map(Number);
  const instant = scheduleDayStart.clone().hour(h).minute(m).second(0).millisecond(0);
  if (toMinutes(hhmm) < toMinutes(powerOn)) {
    instant.add(1, 'day');
  }
  return instant;
}

/**
 * Build the projected temperature curve for the selected side from `from`
 * (usually "now") through `to`, in the given time zone.
 *
 * Walks the two schedule-days straddling the window (the night's own day and
 * the previous day, whose late setpoints can spill past midnight into it),
 * collects every setpoint instant, sorts them, and emits a step point at each
 * boundary in [from, to], prefixed with the setpoint active at `from`.
 *
 * Returns an empty array when the side has no temperature setpoints in range.
 */
export function computeProjectedCurve(
  schedules: Schedules | undefined,
  side: Side,
  timeZone: string,
  fromMs: number,
  toMs: number,
): ProjectedPoint[] {
  if (!schedules?.[side]) return [];
  if (toMs <= fromMs) return [];

  // Gather setpoint instants from the day of `from`, the previous day (spillover
  // past midnight), and the next day (setpoints later tonight that live on the
  // next calendar day when power.on is in the evening).
  const anchor = moment.tz(fromMs, timeZone).startOf('day');
  const candidates: ProjectedPoint[] = [];

  for (const dayOffset of [-1, 0, 1]) {
    const dayStart = anchor.clone().add(dayOffset, 'day');
    const dayKey = DAY_KEYS[dayStart.day()];
    const daySchedule = schedules[side][dayKey];
    if (!daySchedule) continue;
    const powerOn = daySchedule.power?.on ?? '21:00';
    const temps = daySchedule.temperatures ?? {};
    for (const [hhmm, targetF] of Object.entries(temps)) {
      if (typeof targetF !== 'number') continue;
      const instant = resolveSetpointInstant(dayStart, hhmm, powerOn);
      candidates.push({ ts: instant.valueOf(), targetF });
    }
  }

  if (candidates.length === 0) return [];

  // Sort by time and collapse duplicates at the same instant (last wins).
  candidates.sort((a, b) => a.ts - b.ts);
  const dedup: ProjectedPoint[] = [];
  for (const c of candidates) {
    if (dedup.length && dedup[dedup.length - 1].ts === c.ts) {
      dedup[dedup.length - 1] = c;
    } else {
      dedup.push(c);
    }
  }

  // The setpoint active at `from` is the last one at or before `from`.
  let activeAtFrom: ProjectedPoint | undefined;
  for (const c of dedup) {
    if (c.ts <= fromMs) activeAtFrom = c;
    else break;
  }

  const out: ProjectedPoint[] = [];
  if (activeAtFrom) {
    out.push({ ts: fromMs, targetF: activeAtFrom.targetF });
  }
  for (const c of dedup) {
    if (c.ts > fromMs && c.ts <= toMs) {
      out.push(c);
    }
  }

  // If there were future setpoints but none active at `from` (schedule starts
  // later tonight), the curve legitimately begins at the first future step.
  return out;
}
