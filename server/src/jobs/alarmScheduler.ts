import schedule from 'node-schedule';
import cbor from 'cbor';
import moment from 'moment-timezone';

import logger from '../logger.js';
import memoryDB from '../db/memoryDB.js';
import serverStatus from '../serverStatus.js';
import schedulesDB from '../db/schedules.js';
import settingsDB, { updateSettings } from '../db/settings.js';
import { AlarmJob, DailySchedule, DayOfWeek, Side } from '../db/schedulesSchema.js';
import { dailyAlarmSchedules } from '../db/scheduleAlarms.js';
import { executeFunction } from '../8sleep/deviceApi.js';
import { compareTimes, getDayIndexForTime, isValidTime, logJob } from './utils.js';
import { connectFranken } from '../8sleep/frankenServer.js';
import { Settings } from '../db/settingsSchema.js';
import { nightBounds } from './nightBounds.js';
import { emitJobEvent } from './jobEvents.js';


const alarmOccurrences = new Map<string, number>();
const activeAlarms = new Map<Side, symbol>();
const OCCURRENCE_RETENTION_MS = 48 * 60 * 60 * 1000;

export const executeAlarm = async (
  { vibrationIntensity, duration, vibrationPattern, side, force=false }: AlarmJob,
  occurrenceId?: string,
) => {
  // Reserve recurring occurrences before awaiting I/O; manual alarms can repeat.
  const occurrenceKey = !force && occurrenceId ? `${side}:${occurrenceId}` : undefined;
  const cutoff = Date.now() - OCCURRENCE_RETENTION_MS;
  for (const [key, timestamp] of alarmOccurrences) {
    if (timestamp < cutoff) alarmOccurrences.delete(key);
  }
  if (occurrenceKey && alarmOccurrences.has(occurrenceKey)) return;
  if (occurrenceKey) alarmOccurrences.set(occurrenceKey, Date.now());
  let fired = false;
  emitJobEvent({ jobName: `alarm-${side}`, status: 'started' });
  try {
    const min10Duration = Math.max(10, duration);
    // Exit is side is in away mode
    await settingsDB.read();
    if (settingsDB.data[side].awayMode && !force) {
      if (settingsDB.data[side].awayMode) {
        logger.debug('Not executing alarm, this side is in away mode!');
        return;
      }
    }

    // Exit if side is off
    const franken = await connectFranken();
    const resp = await franken.getDeviceStatus();
    if (!resp[side].isOn && !force) {
      logger.debug('Not executing alarm, side is off!');
      return;
    }

    const currentTime = moment.tz(settingsDB.data.timeZone);
    const alarmTimeEpoch = currentTime.unix();

    const alarmPayload = {
      pl: vibrationIntensity,
      du: min10Duration,
      pi: vibrationPattern,
      tt: alarmTimeEpoch,
    };

    const cborPayload = cbor.encode(alarmPayload);
    const hexPayload = cborPayload.toString('hex');
    const command = side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT';

    logger.debug(`Executing alarm... ${JSON.stringify(alarmPayload)}`);
    await executeFunction(command, hexPayload);
    fired = true;
    const activeAlarm = Symbol(side);
    activeAlarms.set(side, activeAlarm);
    await memoryDB.read();
    memoryDB.data[side].isAlarmVibrating = true;
    await memoryDB.write();

    setTimeout(
      async () => {
        if (activeAlarms.get(side) !== activeAlarm) return;
        await memoryDB.read();
        if (activeAlarms.get(side) !== activeAlarm) return;
        activeAlarms.delete(side);
        memoryDB.data[side].isAlarmVibrating = false;
        await memoryDB.write();
      },
      min10Duration * 1_000
    );
    serverStatus.status.alarmSchedule.status = 'healthy';
    serverStatus.status.alarmSchedule.message = '';
    emitJobEvent({ jobName: `alarm-${side}`, status: 'ok' });
  } catch (error: unknown) {
    serverStatus.status.alarmSchedule.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    serverStatus.status.alarmSchedule.message = message;
    logger.error(error);
    emitJobEvent({ jobName: `alarm-${side}`, status: 'fail', message });
  } finally {
    if (occurrenceKey && !fired) alarmOccurrences.delete(occurrenceKey);
  }
};


/**
 * Next occurrence of HH:mm in tz (today or tomorrow depending on 'now').
 * If the HH:mm is already passed for 'now', schedule for tomorrow.
 */
function nextOccurrenceHhMm(tz: string, hhmm: string) {
  const now = moment.tz(tz);
  const [h, m] = hhmm.split(':').map(Number);

  const candidate = now.clone().hour(h).minute(m).second(0).millisecond(0);
  if (candidate.isSameOrBefore(now)) {
    candidate.add(1, 'day');
  }

  return candidate;
}

/**
 * One-off alarm: stand-alone alarm that fires once at a specific datetime then
 * auto-disables itself. Independent of the per-day-of-week recurring alarm.
 *
 * The fireAt field is an ISO 8601 string including offset (e.g.
 * "2026-04-30T07:00:00-07:00"). After firing we flip enabled=false and write
 * the settings back, which triggers chokidar to setupJobs() and the rebuilt
 * scheduler skips this branch.
 */
export function scheduleOneOffAlarm(settingsData: Settings, side: Side) {
  const o = settingsData[side]?.oneOffAlarm;
  if (!o?.enabled) return null;
  if (!o.fireAt) return null;

  const fireAt = moment(o.fireAt);
  if (!fireAt.isValid()) {
    logger.warn(`One-off alarm for ${side} has invalid fireAt: ${o.fireAt}`);
    return null;
  }
  const now = moment();
  if (!fireAt.isAfter(now)) {
    // Disable only this expired occurrence; keep concurrent user saves.
    logger.debug(`One-off alarm for ${side} fireAt is in the past; disabling.`);
    updateSettings(draft => {
      if (draft[side].oneOffAlarm.fireAt !== o.fireAt || !draft[side].oneOffAlarm.enabled) return false;
      draft[side].oneOffAlarm.enabled = false;
    })
      .catch((err) => logger.warn(`Failed to clear stale one-off alarm: ${err}`));
    return null;
  }

  logger.debug(`Scheduling one-off alarm for ${side} at ${fireAt.format()}`);
  schedule.scheduleJob(`${side}-one-off-alarm`, fireAt.toDate(), async () => {
    try {
      await executeAlarm({
        side,
        vibrationIntensity: o.vibrationIntensity,
        duration: o.duration,
        vibrationPattern: o.vibrationPattern,
      });
    } finally {
      // Auto-disable after firing (or after attempt) so the user doesn't
      // need to come back and manually toggle it off, which is the whole
      // point of a "one-off" alarm.
      try {
        await updateSettings(draft => {
          if (draft[side].oneOffAlarm.fireAt !== o.fireAt || !draft[side].oneOffAlarm.enabled) return false;
          draft[side].oneOffAlarm.enabled = false;
        });
      } catch (err) {
        logger.error(`Failed to auto-disable one-off alarm for ${side}: ${err}`);
      }
    }
  });
}


export function scheduleAlarmOverride(settingsData: Settings, side: Side) {
  if (!settingsData[side].alarmsEnabled) return null;
  const alarmOverride = settingsData[side]?.scheduleOverrides?.alarm;
  if (!alarmOverride || alarmOverride.disabled) return null;
  if (!alarmOverride.timeOverride || !alarmOverride.expiresAt) return null;

  const now = moment.tz(settingsData.timeZone);
  const expiresAt = moment.tz(alarmOverride.expiresAt, settingsData.timeZone);
  if (!expiresAt.isAfter(now)) return null;
  const next = nextOccurrenceHhMm(settingsData.timeZone, alarmOverride.timeOverride);
  if (!next.isBefore(expiresAt)) return null;
  logger.debug(`Alarm override is set! Scheduling alarm for ${next.format()}`);

  schedule.scheduleJob(`${side}-alarm-override-${alarmOverride.timeOverride}`, next.toDate(), async () => {
    // The replacement belongs to a night starting today or yesterday, not
    // necessarily the calendar date on which it rings.
    let sourceAlarm;
    for (const offset of [-1, 0]) {
      const date = next.clone().startOf('day').add(offset, 'day');
      const dayKey = date.format('dddd').toLowerCase() as DayOfWeek;
      const daily = schedulesDB.data?.[side]?.[dayKey];
      if (!daily?.power.enabled) continue;
      const { start, end } = nightBounds(date, daily.power);
      if (!next.isBetween(start, end, undefined, '[]')) continue;
      sourceAlarm = dailyAlarmSchedules(daily).filter(alarm => alarm.enabled)
        .sort((a, b) => {
          const minutes = (time: string) => {
            const [h, m] = time.split(':').map(Number);
            return h * 60 + m + (compareTimes(time, daily.power.on) < 0 ? 1440 : 0);
          };
          return minutes(a.time) - minutes(b.time);
        })[0];
      if (sourceAlarm) break;
    }
    const { vibrationIntensity, duration, vibrationPattern } = sourceAlarm ?? {
      vibrationIntensity: 100,
      duration: 60,
      vibrationPattern: 'rise',
    };

    await executeAlarm({
      side,
      vibrationIntensity,
      duration,
      vibrationPattern,
    });
  });
}


export const scheduleAlarm = (settingsData: Settings, side: Side, day: DayOfWeek, dailySchedule: DailySchedule) => {
  // Recurring alarms stay coupled to the day's power schedule; the runtime
  // isOn check inside executeAlarm still skips a manually-off pod.
  if (!dailySchedule.power.enabled) return;
  if (!settingsData[side].alarmsEnabled) return;
  if (settingsData[side].awayMode) return;
  if (settingsData.timeZone === null) return;

  const enabledAlarms = dailyAlarmSchedules(dailySchedule).filter(alarm => alarm.enabled);
  enabledAlarms.forEach((alarm, alarmIndex) => {
    const alarmRule = new schedule.RecurrenceRule();

    const { time } = alarm;
    // Schedule data written before the API validated alarm entries, or edited
    // by hand, can be missing a time. Skip that alarm instead of throwing, so
    // one bad entry cannot take down the rest of the pod's jobs.
    if (!isValidTime(time)) {
      logger.warn(`Skipping ${side} ${day} alarm ${alarmIndex}: invalid time ${JSON.stringify(time)}`);
      return;
    }
    // Resolve the alarm's day from its own time against the day's power on,
    // not from power.off: an alarm and the power off can sit on opposite
    // sides of midnight, and keying off power.off moved the alarm to another
    // weekday whenever the off time changed.
    const dayIndex = getDayIndexForTime(day, time, dailySchedule.power.on);
    alarmRule.dayOfWeek = dayIndex;
    const [alarmHour, alarmMinute] = time.split(':').map(Number);
    alarmRule.hour = alarmHour;
    alarmRule.minute = alarmMinute;
    alarmRule.tz = settingsData.timeZone;

    logJob('Scheduling alarm job', side, day, dayIndex, time);

    schedule.scheduleJob(`${side}-${day}-${time}-${alarmIndex}-alarm`, alarmRule, async () => {
      try {
        logJob('Executing alarm job', side, day, dayIndex, time);
        await settingsDB.read();

        const now = moment.tz(settingsData.timeZone);
        if (settingsDB.data[side].scheduleOverrides.alarm.expiresAt) {
          const expiresAt = moment.tz(settingsDB.data[side].scheduleOverrides.alarm.expiresAt, settingsData.timeZone);
          // Keep the night's original alarms suppressed after an earlier replacement.
          const date = now.clone().startOf('day');
          if (compareTimes(time, dailySchedule.power.on) < 0) date.subtract(1, 'day');
          const { start: nightStart, end: nightEnd } = nightBounds(date, dailySchedule.power);
          if (expiresAt.isAfter(now) || expiresAt.isBetween(nightStart, nightEnd, undefined, '(]')) {
            logJob(`Detected alarm override! Skipping alarm! Override expires at: ${expiresAt.format()}`, side, day, dayIndex, time);
            return;
          }
        }

        await executeAlarm({
          side,
          vibrationIntensity: alarm.vibrationIntensity,
          duration: alarm.duration,
          vibrationPattern: alarm.vibrationPattern,
        }, `recurring:${day}:${time}:${now.format('YYYY-MM-DD')}`);
      } catch (error: unknown) {
        serverStatus.status.alarmSchedule.status = 'failed';
        const message = error instanceof Error ? error.message : String(error);
        serverStatus.status.alarmSchedule.message = message;
        logger.error(error);
      }
    });
  });
};
