// Logic for "if user manually changes temp shortly before the next scheduled
// change, suppress the rest of the schedule."
//
// Wiring: call markManualTempChange() from each manual-change path
// (POST /api/deviceStatus, tap gestures). DO NOT call it from the scheduler
// jobs themselves, those are the ones we want to be suppressed.
import moment from 'moment-timezone';
import settingsDB, { updateSettings } from '../db/settings.js';
import schedulesDB from '../db/schedules.js';
import { Side, DayOfWeek } from '../db/schedulesSchema.js';
import logger from '../logger.js';
import { compareTimes, isValidTime } from './utils.js';

export const OVERRIDE_WINDOW_HOURS = 3;
export const OVERRIDE_DURATION_HOURS = 12;

const DAYS: DayOfWeek[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

// Include yesterday's schedule: its after-midnight events run today.
function findNextScheduledTempChange(
  side: Side,
  now: moment.Moment,
  timeZone: string,
): moment.Moment | null {
  const sideSchedule = schedulesDB.data[side];
  if (!sideSchedule) return null;

  let next: moment.Moment | null = null;
  for (let dayOffset = -1; dayOffset < 2; dayOffset++) {
    const candidateDay = now.clone().tz(timeZone).add(dayOffset, 'day');
    const dayName = DAYS[candidateDay.day()];
    const daily = sideSchedule[dayName];
    if (!daily?.power.enabled || !daily.temperatures) continue;

    // Power-on applies a temperature too, even when there are no later adjustments.
    const times = new Set([daily.power.on, ...Object.keys(daily.temperatures)]);
    for (const time of times) {
      if (!isValidTime(time)) continue;
      const [h, m] = time.split(':').map(Number);
      const candidate = candidateDay
        .clone()
        .hour(h)
        .minute(m)
        .second(0)
        .millisecond(0);
      if (compareTimes(time, daily.power.on) < 0) candidate.add(1, 'day');
      if (candidate.isAfter(now) && (!next || candidate.isBefore(next))) {
        next = candidate;
      }
    }
  }
  return next;
}

export const isTempScheduleOverridden = (side: Side): boolean => {
  const override = settingsDB.data[side]?.scheduleOverrides?.temperatureSchedules;
  if (!override?.disabled) return false;
  if (!override.expiresAt) return false;
  return moment(override.expiresAt).isAfter(moment());
};

export const markManualTempChange = async (side: Side): Promise<void> => {
  await schedulesDB.read();
  await updateSettings(draft => {
    const timeZone = draft.timeZone || 'UTC';
    const now = moment.tz(timeZone);
    const next = findNextScheduledTempChange(side, now, timeZone);
    if (!next || next.diff(now, 'minutes') / 60 > OVERRIDE_WINDOW_HOURS) return false;
    const expiresAt = now.clone().add(OVERRIDE_DURATION_HOURS, 'hours').format();
    draft[side].scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt };
    logger.info(`[manual temp] ${side}: schedule paused until ${expiresAt} (next change was at ${next.format()}).`);
  });
};
