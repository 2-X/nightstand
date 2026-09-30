import moment from 'moment-timezone';
import schedule from 'node-schedule';
import logger from '../../logger.js';
import type { Settings } from '../../db/settingsSchema.js';
import type { Side } from '../../db/schedulesSchema.js';
import type { RhythmsDB } from '../../db/rhythmsSchema.js';
import { SCHEDULE_SIDES } from '../../db/scheduleKeys.js';
import { effectiveSides } from '../scheduleQueries.js';
import { resolveSleeps, type ResolvedSleep, type RhythmEvent } from './resolve.js';
import { ANALYSIS_DELAY_MS, ANALYSIS_MAX_WINDOW_MS, REANALYSIS_DELAY_MS, runRhythmEvent, runSleepAnalysis } from './runEvent.js';
import { trackAlarm } from '../alarmActivity.js';
import { scheduleSleepAnalysis } from '../powerScheduler.js';
import { SLEEP_ANALYSIS_HOUR, SLEEP_ANALYSIS_MINUTE } from '../../sleepAnalysisSchedule.js';

export const RHYTHMS_HORIZON_MS = 48 * 60 * 60 * 1000;
export const RHYTHMS_HORIZON_JOB = 'rhythms-horizon';
// Weekly data can store a temperature or alarm after its night's power off,
// and the weekly engine fires it, so recent sleeps resolve too. It also keeps
// the analyses of a sleep that ended in the last two hours. Past instants are
// skipped.
export const RHYTHMS_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export function rhythmJobName(
  side: Side,
  date: string,
  kind: RhythmEvent['kind'] | 'analysis',
  at: Date,
  timeZone: string,
  n: number,
): string {
  return `rhythm-${side}-${date}-${kind}-${moment.tz(at, timeZone).format('HHmm')}-${n}`;
}

// node-schedule keeps a dead entry for a date in the past, so past instants
// and names already planned are skipped before asking it. A failed job is
// logged: a rejected job becomes an unhandled rejection, which stops the server.
function scheduleOnce(name: string, at: Date, now: Date, run: () => Promise<unknown>): boolean {
  if (at.getTime() <= now.getTime() || schedule.scheduledJobs[name]) return false;
  const job = () => run().catch((error: unknown) => {
    logger.error(`Rhythm job ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (schedule.scheduleJob(name, at, job)) return true;
  schedule.cancelJob(name);
  return false;
}

function scheduleSleep(settings: Settings, side: Side, sleep: ResolvedSleep, now: Date, timeZone: string): number {
  let count = 0;
  const seen = new Map<RhythmEvent['kind'], number>();
  for (const event of sleep.events) {
    const n = seen.get(event.kind) ?? 0;
    seen.set(event.kind, n + 1);
    if (event.kind === 'alarm' && !settings[side].alarmsEnabled) continue;
    const name = rhythmJobName(side, sleep.date, event.kind, event.at, timeZone, n);
    // Alarm jobs register as they start, so a power-off due in the same
    // minute waits for them.
    const run = event.kind === 'alarm'
      ? () => trackAlarm(side, name, () => runRhythmEvent(side, sleep, event))
      : () => runRhythmEvent(side, sleep, event);
    if (scheduleOnce(name, event.at, now, run)) count += 1;
  }
  const analysisAt = new Date(sleep.end.getTime() + ANALYSIS_DELAY_MS);
  const analysisName = rhythmJobName(side, sleep.date, 'analysis', analysisAt, timeZone, 0);
  if (scheduleOnce(analysisName, analysisAt, now, () => runSleepAnalysis(side, sleep))) count += 1;
  // Someone still in bed at the first run gets a record cut off there. The
  // later run looks back the analyzer's full window and replaces it.
  const reanalysisAt = new Date(sleep.end.getTime() + REANALYSIS_DELAY_MS);
  const reanalysisName = rhythmJobName(side, sleep.date, 'analysis', reanalysisAt, timeZone, 1);
  const reanalyse = () => runSleepAnalysis(side, sleep, REANALYSIS_DELAY_MS, ANALYSIS_MAX_WINDOW_MS);
  if (scheduleOnce(reanalysisName, reanalysisAt, now, reanalyse)) count += 1;
  return count;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A sleep that ended in the day before `at` has its own analyses.
function sleptWithin(db: RhythmsDB, side: Side, timeZone: string, at: Date): boolean {
  const from = new Date(at.getTime() - DAY_MS);
  return resolveSleeps({ db, side, timeZone, from, to: at }).some(sleep => sleep.end > from && sleep.end <= at);
}

function nextNoon(now: Date, timeZone: string): Date {
  const noon = moment.tz(now, timeZone).hour(SLEEP_ANALYSIS_HOUR).minute(SLEEP_ANALYSIS_MINUTE).startOf('minute');
  if (!noon.isAfter(now)) noon.add(1, 'day');
  return noon.toDate();
}

// The hourly job extends from whatever was planned last.
let latest: { settings: Settings; db: RhythmsDB } | null = null;

function scheduleHorizon(timeZone: string, extend: () => void): void {
  if (schedule.scheduledJobs[RHYTHMS_HORIZON_JOB]) return;
  const rule = new schedule.RecurrenceRule();
  rule.minute = 0;
  rule.tz = timeZone;
  schedule.scheduleJob(RHYTHMS_HORIZON_JOB, rule, extend);
}

// A side with no sleep ending in the day before noon, such as one with no
// rhythms or a night with no sleep, keeps the weekly noon analysis. Each run
// checks again, since a later day may have a sleep with its own analyses.
function keepNoonAnalysis(settings: Settings, side: Side): void {
  if (schedule.scheduledJobs[`daily-analyze-sleep-${side}`]) return;
  scheduleSleepAnalysis(settings, side, at => {
    if (!latest?.settings.timeZone) return false;
    try {
      return sleptWithin(latest.db, side, latest.settings.timeZone, at);
    } catch (error: unknown) {
      logger.error(`Rhythms could not check the ${side} noon analysis: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  });
}

export type RhythmsPlan = { jobCount: number; failedSides: Side[] };

// Settings and data saves rebuild every job, so the hourly job only adds
// the sleeps that have come into range. A side that cannot be resolved is
// logged and skipped, so the other side and the rest of the rebuild still run.
export function scheduleRhythms(settings: Settings, db: RhythmsDB, now: Date): RhythmsPlan {
  const timeZone = settings.timeZone;
  if (!timeZone) return { jobCount: 0, failedSides: [] };
  latest = { settings, db };
  const from = new Date(now.getTime() - RHYTHMS_LOOKBACK_MS);
  const to = new Date(now.getTime() + RHYTHMS_HORIZON_MS);
  let jobCount = 0;
  const failedSides: Side[] = [];
  for (const side of SCHEDULE_SIDES) {
    if (effectiveSides(settings, side).length === 0) {
      logger.debug(`Rhythms: ${side} is away, its own rhythm is not scheduled`);
      continue;
    }
    let keepNoon = true;
    try {
      for (const sleep of resolveSleeps({ db, side, timeZone, from, to })) {
        jobCount += scheduleSleep(settings, side, sleep, now, timeZone);
      }
      keepNoon = !sleptWithin(db, side, timeZone, nextNoon(now, timeZone));
    } catch (error: unknown) {
      failedSides.push(side);
      logger.error(`Rhythms could not plan ${side}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (keepNoon) keepNoonAnalysis(settings, side);
  }
  scheduleHorizon(timeZone, () => {
    if (!latest) return;
    try {
      const added = scheduleRhythms(latest.settings, latest.db, new Date()).jobCount;
      logger.debug(`Rhythms horizon added ${added} job(s)`);
    } catch (error: unknown) {
      logger.error(`Rhythms horizon failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { jobCount, failedSides };
}
