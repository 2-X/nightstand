import schedule from 'node-schedule';
import cbor from 'cbor';
import moment from 'moment-timezone';

import logger from '../logger.js';
import memoryDB from '../db/memoryDB.js';
import serverStatus from '../serverStatus.js';
import schedulesDB from '../db/schedules.js';
import recurringAlarmsDB from '../db/recurringAlarms.js';
import settingsDB from '../db/settings.js';
import { AlarmJob, DailySchedule, DayOfWeek, RecurringAlarm, Side } from '../db/schedulesSchema.js';
import { dailyAlarmSchedules } from '../db/scheduleAlarms.js';
import { executeFunction } from '../8sleep/deviceApi.js';
import { getDayIndexForTime, isValidTime, logJob } from './utils.js';
import { expandAlarmOccurrences } from './recurrenceExpansion.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { connectFranken } from '../8sleep/frankenServer.js';
import { Settings } from '../db/settingsSchema.js';
import { emitJobEvent } from './jobEvents.js';
import { recordEvent } from '../db/collector.js';


// A repeated fall-back hour replays an alarm ~60 min later, so anything inside
// this window is the same alarm firing twice, not a second intentional alarm.
const ALARM_DEDUPE_MS = 50 * 60 * 1000;

export const executeAlarm = async ({ vibrationIntensity, duration, vibrationPattern, side, force=false }: AlarmJob) => {
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

    // On the DST fall-back day a time between 01:00 and 01:59 occurs twice, so
    // node-schedule fires the same alarm again an hour later. Swallow a repeat
    // that lands within the dedupe window rather than vibrating the bed twice.
    await memoryDB.read();
    const lastFiredAt = memoryDB.data[side].lastAlarmFiredAt;
    if (!force && lastFiredAt !== undefined && Date.now() - lastFiredAt < ALARM_DEDUPE_MS) {
      logger.debug(`Skipping duplicate alarm for ${side}, one already fired recently`);
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
    await memoryDB.read();
    memoryDB.data[side].isAlarmVibrating = true;
    memoryDB.data[side].lastAlarmFiredAt = Date.now();
    await memoryDB.write();

    setTimeout(
      async () => {
        logger.debug('');
        await memoryDB.read();
        memoryDB.data[side].isAlarmVibrating = false;
        await memoryDB.write();
      },
      min10Duration * 1_000
    );
    recordEvent('alarm_fired', {
      side,
      payload: {
        intensity: vibrationIntensity,
        duration: min10Duration,
        pattern: vibrationPattern,
        scheduledTime: alarmTimeEpoch,
      },
      source: 'jobs/alarmScheduler',
    });
    serverStatus.status.alarmSchedule.status = 'healthy';
    serverStatus.status.alarmSchedule.message = '';
    emitJobEvent({ jobName: `alarm-${side}`, status: 'ok' });
  } catch (error: unknown) {
    serverStatus.status.alarmSchedule.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    serverStatus.status.alarmSchedule.message = message;
    logger.error(error);
    emitJobEvent({ jobName: `alarm-${side}`, status: 'fail', message });
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
    // Already in the past, so auto-disable it here so it doesn't keep tripping
    // the chokidar->setupJobs loop on every save. We do this best-effort and
    // don't await; if the write races with another save, the worst case is
    // one extra no-op rebuild.
    logger.debug(`One-off alarm for ${side} fireAt is in the past; disabling.`);
    settingsDB.read()
      .then(() => {
        if (settingsDB.data[side].oneOffAlarm.fireAt === o.fireAt) {
          settingsDB.data[side].oneOffAlarm.enabled = false;
          return settingsDB.write();
        }
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
        await settingsDB.read();
        if (settingsDB.data[side].oneOffAlarm.fireAt === o.fireAt) {
          settingsDB.data[side].oneOffAlarm.enabled = false;
          await settingsDB.write();
        }
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
  logger.debug(`Alarm override is set! Scheduling alarm for ${next.format()}`);

  schedule.scheduleJob(`${side}-alarm-override-${alarmOverride.timeOverride}`, next.toDate(), async () => {
    const dayKey = next.tz(settingsData.timeZone).format('dddd').toLowerCase() as DayOfWeek;
    const daySchedule = schedulesDB.data?.[side]?.[dayKey];

    const sourceAlarm = daySchedule ? dailyAlarmSchedules(daySchedule)[0] : null;
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


// True once Phase 2 recurring alarms are the source of truth for a side (the
// list is non-empty). When so, the legacy per-day scheduleAlarm() below stands
// down for that side so the two paths never both arm a job and double-vibrate.
export function hasRecurringAlarms(side: Side): boolean {
  const list = recurringAlarmsDB.data?.[side];
  return Array.isArray(list) && list.length > 0;
}


// --- Phase 2: recurring-alarm scheduling -----------------------------------

// How far ahead we look for the next occurrence of each alarm. everyNDays with
// large n can have gaps; 400 days comfortably covers the widest allowed n.
const RECURRENCE_LOOKAHEAD_MS = 400 * 24 * 60 * 60 * 1000;

// Wake temp the warm ramp aims for when the alarm itself doesn't name one.
const DEFAULT_WARM_RAMP_TARGET_F = 82;

function warmRampTargetForSide(side: Side, alarm: RecurringAlarm): number {
  if (typeof alarm.warmRampTargetF === 'number') return alarm.warmRampTargetF;
  // Fall back to any enabled power schedule's onTemperature for the side, else
  // a sane default. We scan the day schedules for the first enabled power block.
  const sideSchedule = schedulesDB.data?.[side];
  if (sideSchedule) {
    for (const day of Object.values(sideSchedule)) {
      if (day?.power?.enabled && typeof day.power.onTemperature === 'number') {
        return day.power.onTemperature;
      }
    }
  }
  return DEFAULT_WARM_RAMP_TARGET_F;
}

// Compute the next occurrence instant (ms) of an alarm strictly after `afterMs`,
// or null if none within the lookahead window.
function nextOccurrenceMs(alarm: RecurringAlarm, timeZone: string, afterMs: number): number | null {
  const occ = expandAlarmOccurrences(
    alarm,
    timeZone,
    afterMs,
    afterMs + RECURRENCE_LOOKAHEAD_MS,
  );
  return occ.length > 0 ? occ[0].epochMs : null;
}

// Arm the warm-ramp temperature step for a single occurrence, if configured
// and still in the future.
function scheduleWarmRamp(side: Side, alarm: RecurringAlarm, occurrenceMs: number) {
  if (!alarm.warmRampMinutes || alarm.warmRampMinutes <= 0) return;
  const rampAtMs = occurrenceMs - alarm.warmRampMinutes * 60 * 1000;
  if (rampAtMs <= Date.now()) return;
  const targetF = warmRampTargetForSide(side, alarm);
  const jobName = `${side}-recurring-${alarm.id}-warmramp`;
  schedule.scheduleJob(jobName, new Date(rampAtMs), async () => {
    try {
      logger.debug(`Executing warm ramp for ${side} alarm ${alarm.id} -> ${targetF}F`);
      await updateDeviceStatus({ [side]: { targetTemperatureF: targetF } });
      recordEvent('warm_ramp', {
        side,
        payload: { alarmId: alarm.id, targetTemperatureF: targetF, warmRampMinutes: alarm.warmRampMinutes },
        source: 'jobs/alarmScheduler',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Warm ramp for ${side} alarm ${alarm.id} failed: ${message}`);
    }
  });
}

// Arm one dated job for the next occurrence of `alarm`. When it fires it
// executes the alarm and self-reschedules the following occurrence, so a single
// job per alarm keeps the recurrence alive between setupJobs() rebuilds.
function armNextRecurringOccurrence(side: Side, alarm: RecurringAlarm, timeZone: string) {
  const nextMs = nextOccurrenceMs(alarm, timeZone, Date.now());
  if (nextMs === null) {
    logger.debug(`No upcoming occurrence for ${side} recurring alarm ${alarm.id} within lookahead`);
    return;
  }
  scheduleWarmRamp(side, alarm, nextMs);

  const jobName = `${side}-recurring-${alarm.id}`;
  logger.debug(`Scheduling recurring alarm ${side}/${alarm.id} for ${new Date(nextMs).toISOString()}`);
  schedule.scheduleJob(jobName, new Date(nextMs), async () => {
    try {
      // Respect an active alarm-schedule override the same way the legacy path
      // does: a temporary override suppresses the recurring fire.
      await settingsDB.read();
      const override = settingsDB.data[side]?.scheduleOverrides?.alarm;
      if (override?.expiresAt) {
        const expiresAt = moment(override.expiresAt);
        if (expiresAt.isAfter(moment())) {
          logger.debug(`Recurring alarm ${side}/${alarm.id} suppressed by override until ${expiresAt.format()}`);
          return;
        }
      }
      await executeAlarm({
        side,
        vibrationIntensity: alarm.vibration.intensity,
        duration: alarm.vibration.duration,
        vibrationPattern: alarm.vibration.pattern,
      });
    } catch (error: unknown) {
      serverStatus.status.alarmSchedule.status = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      serverStatus.status.alarmSchedule.message = message;
      logger.error(error);
    } finally {
      // Re-arm the following occurrence. Re-read the DB / settings so a delete
      // or disable made since this job was armed is honored on the next hop.
      try {
        await recurringAlarmsDB.read();
        await settingsDB.read();
        const stillEnabledSide = settingsDB.data[side]?.alarmsEnabled && !settingsDB.data[side]?.awayMode;
        const current = recurringAlarmsDB.data?.[side]?.find((a) => a.id === alarm.id);
        const tz = settingsDB.data.timeZone;
        if (stillEnabledSide && current?.enabled && tz) {
          armNextRecurringOccurrence(side, current, tz);
        }
      } catch (err) {
        logger.warn(`Failed to re-arm recurring alarm ${side}/${alarm.id}: ${err}`);
      }
    }
  });
}

/**
 * Arm all enabled recurring alarms for a side. Called from setupJobs() after
 * the old jobs are cancelled. Unlike the legacy per-day scheduler this is NOT
 * gated on any single day's power.enabled — a recurring alarm fires on its own
 * calendar; the runtime isOn / awayMode checks inside executeAlarm still skip a
 * powered-off pod.
 */
export function scheduleRecurringAlarms(settingsData: Settings, side: Side) {
  if (!settingsData[side].alarmsEnabled) return;
  if (settingsData[side].awayMode) return;
  const timeZone = settingsData.timeZone;
  if (!timeZone) return;

  const alarms = recurringAlarmsDB.data?.[side] ?? [];
  alarms
    .filter((alarm) => alarm.enabled)
    .forEach((alarm) => {
      if (!isValidTime(alarm.time)) {
        logger.warn(`Skipping ${side} recurring alarm ${alarm.id}: invalid time ${JSON.stringify(alarm.time)}`);
        return;
      }
      try {
        armNextRecurringOccurrence(side, alarm, timeZone);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to schedule recurring alarm ${side}/${alarm.id}: ${message}`);
      }
    });
}


export const scheduleAlarm = (settingsData: Settings, side: Side, day: DayOfWeek, dailySchedule: DailySchedule) => {
  // Once the side has Phase 2 recurring alarms, they own alarm scheduling and
  // this legacy per-day path stands down to avoid arming a duplicate job.
  if (hasRecurringAlarms(side)) return;
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

        if (settingsDB.data[side].scheduleOverrides.alarm.expiresAt) {
          const expiresAt = moment(settingsDB.data[side].scheduleOverrides.alarm.expiresAt);
          const now = moment();
          if (expiresAt.isAfter(now)) {
            logJob(`Detected alarm override! Skipping alarm! Override expires at: ${expiresAt.format()}`, side, day, dayIndex, time);
            return;
          }
        }

        await executeAlarm({
          side,
          vibrationIntensity: alarm.vibrationIntensity,
          duration: alarm.duration,
          vibrationPattern: alarm.vibrationPattern,
        });
      } catch (error: unknown) {
        serverStatus.status.alarmSchedule.status = 'failed';
        const message = error instanceof Error ? error.message : String(error);
        serverStatus.status.alarmSchedule.message = message;
        logger.error(error);
      }
    });
  });
};

