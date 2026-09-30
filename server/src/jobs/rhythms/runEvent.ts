import moment from 'moment-timezone';
import logger from '../../logger.js';
import memoryDB from '../../db/memoryDB.js';
import servicesDB from '../../db/services.js';
import settingsDB from '../../db/settings.js';
import type { Settings } from '../../db/settingsSchema.js';
import serverStatus from '../../serverStatus.js';
import type { Side } from '../../db/schedulesSchema.js';
import { updateDeviceStatus } from '../../routes/deviceStatus/updateDeviceStatus.js';
import { connectFrankenWithin } from '../../8sleep/frankenServer.js';
import { executeAlarm } from '../alarmScheduler.js';
import { rhythmNightAlarms, waitForNightAlarms } from '../alarmActivity.js';
import { executeAnalyzeSleep } from '../analyzeSleep.js';
import { notePowerOn, poweredOnSince } from '../powerScheduler.js';
import { isTempScheduleOverridden } from '../scheduleOverride.js';
import { effectiveSides, engineActivation } from '../scheduleQueries.js';
import { rhythmSkipReason } from './gates.js';
import type { ResolvedSleep, RhythmEvent } from './resolve.js';

export const FIRMWARE_MARGIN_SECONDS = 300;
export const FIRMWARE_MAX_SECONDS = 43200;
export const ANALYSIS_DELAY_MS = 15 * 60 * 1000;
// A person still in bed at the first run gets a record cut off there; this
// later, longer run replaces it.
export const REANALYSIS_DELAY_MS = 2 * 60 * 60 * 1000;
// The analyzer's longest window. The later run looks back this far from its
// end, so a night that began well before the resolved start is stored whole.
export const ANALYSIS_MAX_WINDOW_MS = 25 * 60 * 60 * 1000;
const ANALYSIS_PADDING_MS = 60 * 60 * 1000;
const DUPLICATE_ANALYSIS_MS = 10 * 60 * 1000;

// Every Rhythms power-on hands the firmware its own off time, so the side
// still turns off at the sleep's end if this server stops or is replaced.
export function firmwareSeconds(sleepEnd: Date, now: Date): number {
  return Math.min(Math.ceil((sleepEnd.getTime() - now.getTime()) / 1000) + FIRMWARE_MARGIN_SECONDS, FIRMWARE_MAX_SECONDS);
}

// The sleep end each side's firmware was last told. Memory only, so after a
// restart a sleep in progress is told again.
const armedEnds = new Map<Side, number>();

export const armedEnd = (side: Side): number | undefined => armedEnds.get(side);

export function forgetArmedEnds(side: Side): void {
  armedEnds.delete(side);
}

// Set when this version hands its sleeps back just before it stops. Until
// then a re-arm or a power-off would undo the handoff. The server normally
// stops seconds later; the hold ends by itself in case it does not.
const HANDED_BACK_HOLD_MS = 10 * 60 * 1000;
let handedBackUntil = 0;

export function holdForHandBack(now: Date): void {
  handedBackUntil = now.getTime() + HANDED_BACK_HOLD_MS;
}

const handedBack = () => Date.now() < handedBackUntil;

// Test isolation only.
export function resetOffTimes(): void {
  armedEnds.clear();
  handedBackUntil = 0;
}

// A write from a side next to an away side reaches both.
function noteArmed(settings: Settings, side: Side, end: Date): void {
  for (const target of effectiveSides(settings, side)) armedEnds.set(target, end.getTime());
}

export function alarmOccurrenceId(side: Side, sleep: ResolvedSleep, at: Date, timeZone: string): string {
  return `rhythm:${side}:${sleep.date}:${moment.tz(at, timeZone).format('HH:mm')}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function markStatus(key: 'powerSchedule' | 'temperatureSchedule', error?: unknown): void {
  if (error === undefined) {
    serverStatus.status[key].status = 'healthy';
    serverStatus.status[key].message = '';
    return;
  }
  serverStatus.status[key].status = 'failed';
  serverStatus.status[key].message = errorMessage(error);
  logger.error(error);
}

// Scheduled writes wait out a reconnect, and only the newest waiting power
// or set point command per setting reaches the Pod.
const SCHEDULED = { background: true };

// Resolves to how long an alarm rings in milliseconds, 0 for anything else.
export async function runRhythmEvent(side: Side, sleep: ResolvedSleep, event: RhythmEvent): Promise<number> {
  const label = `rhythm ${event.kind} for ${side} (${sleep.date})`;
  if (event.kind === 'power-on') notePowerOn(side, event.at);
  if (event.kind === 'power-off') {
    // An alarm due with the power-off rings first; otherwise it would find
    // the side off and skip.
    await waitForNightAlarms(side, event.at, rhythmNightAlarms(side, sleep.date));
  }
  await settingsDB.read();
  const settings = settingsDB.data;
  const now = new Date();
  // A power-off is judged at its due time: waiting for an alarm must not
  // carry it past the end of a pause.
  const judgedAt = event.kind === 'power-off' ? event.at : now;
  const skip = rhythmSkipReason(settings, side, sleep, event.kind, judgedAt, event.at);
  if (skip) {
    // A paused power-off writes nothing, as in the weekly engine; the side's own timer ends it.
    logger.info(`Skipping ${label}: ${skip}`);
    return 0;
  }
  if (event.kind === 'power-off' && poweredOnSince(side, event.at)) {
    logger.info(`Skipping ${label}: the next sleep already started`);
    return 0;
  }
  if (event.kind === 'power-off' && handedBack()) {
    logger.info(`Skipping ${label}: the sleep was handed back before this version stops`);
    return 0;
  }
  if (event.kind === 'power-on' && now.getTime() >= sleep.end.getTime()) {
    logger.warn(`Skipping ${label}: the sleep already ended`);
    return 0;
  }
  logger.info(`Executing ${label}`);
  try {
    if (event.kind === 'power-on') {
      const secondsRemaining = firmwareSeconds(sleep.end, now);
      const held = isTempScheduleOverridden(side);
      if (held) logger.info(`Temperature held by a manual change, powering ${side} on without setting it`);
      await updateDeviceStatus({
        [side]: held ? { isOn: true, secondsRemaining } : { isOn: true, targetTemperatureF: event.temperatureF, secondsRemaining },
      }, SCHEDULED);
      noteArmed(settings, side, sleep.end);
      markStatus('powerSchedule');
    } else if (event.kind === 'temperature') {
      if (isTempScheduleOverridden(side)) {
        logger.info(`Skipping ${label}: held by a manual change`);
        return 0;
      }
      await updateDeviceStatus({ [side]: { targetTemperatureF: event.temperatureF } }, SCHEDULED);
      markStatus('temperatureSchedule');
    } else if (event.kind === 'alarm') {
      const { vibrationIntensity, duration, vibrationPattern } = event.alarm;
      const occurrenceId = alarmOccurrenceId(side, sleep, event.at, settings.timeZone || 'UTC');
      return await executeAlarm(
        { side, vibrationIntensity, duration, vibrationPattern },
        occurrenceId,
        { ...SCHEDULED, dueAt: event.at.getTime() },
      );
    } else {
      await updateDeviceStatus({ [side]: { isOn: false } }, SCHEDULED);
      markStatus('powerSchedule');
    }
  } catch (error: unknown) {
    markStatus(event.kind === 'temperature' ? 'temperatureSchedule' : 'powerSchedule', error);
  }
  return 0;
}

// Gives a sleep in progress the off time it now ends at, when that is not the
// one its power-on sent. A non-zero duration turns a side on, so only a side
// read as on is changed; an unread side is tried again on the next plan.
export async function rearmRhythmSleep(side: Side, sleep: ResolvedSleep): Promise<void> {
  if (armedEnds.get(side) === sleep.end.getTime()) return;
  const label = `rhythm off time for ${side} (${sleep.date})`;
  if (handedBack()) {
    logger.info(`Skipping ${label}: the sleep was handed back before this version stops`);
    return;
  }
  await settingsDB.read();
  const settings = settingsDB.data;
  const skip = rhythmSkipReason(settings, side, sleep, 'rearm', new Date());
  if (skip) {
    logger.info(`Skipping ${label}: ${skip}`);
    return;
  }
  if (Date.now() >= sleep.end.getTime()) return;
  let isOn: boolean;
  try {
    // Waits a bounded time for a reconnect, as an alarm does.
    const franken = await connectFrankenWithin(SCHEDULED);
    isOn = (await franken.getDeviceStatus())[side].isOn;
  } catch (error: unknown) {
    logger.warn(`Skipping ${label}: could not read the Pod: ${errorMessage(error)}`);
    return;
  }
  // The read can wait out a reconnect, long enough for Rhythms to be turned off.
  if (!engineActivation().active || handedBack() || Date.now() >= sleep.end.getTime()) return;
  if (!isOn) {
    logger.info(`Skipping ${label}: the side is off`);
    noteArmed(settings, side, sleep.end);
    return;
  }
  logger.info(`Executing ${label}`);
  try {
    await updateDeviceStatus({ [side]: { secondsRemaining: firmwareSeconds(sleep.end, new Date()) } }, SCHEDULED);
    noteArmed(settings, side, sleep.end);
    markStatus('powerSchedule');
  } catch (error: unknown) {
    markStatus('powerSchedule', error);
  }
}

// Analyses from an hour before the sleep's start, or lookbackMs before the
// window's end when given, to padAfterMs after its end.
export async function runSleepAnalysis(
  side: Side,
  sleep: ResolvedSleep,
  padAfterMs = ANALYSIS_PADDING_MS,
  lookbackMs?: number,
): Promise<void> {
  await settingsDB.read();
  if (rhythmSkipReason(settingsDB.data, side, sleep, 'analysis', new Date())) return;
  await servicesDB.read();
  if (!servicesDB.data.biometrics.enabled) {
    logger.debug('Not running end-of-sleep analysis, biometrics is disabled');
    return;
  }
  await memoryDB.read();
  const now = performance.now();
  const lastRan = memoryDB.data[side].analyzeSleep.lastRan;
  if (lastRan && now - lastRan <= DUPLICATE_ANALYSIS_MS) {
    logger.debug(`Duplicate end-of-sleep analysis for ${side}, skipping`);
    return;
  }
  memoryDB.data[side].analyzeSleep.lastRan = now;
  await memoryDB.write();
  const endMs = sleep.end.getTime() + padAfterMs;
  const startMs = lookbackMs === undefined ? sleep.start.getTime() - ANALYSIS_PADDING_MS : endMs - lookbackMs;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  logger.info(`Executing end-of-sleep analysis for ${side} (${sleep.date})`);
  executeAnalyzeSleep(side, start, end);
}
