import { EventEmitter } from 'node:events';
import schedule from 'node-schedule';
import { DayOfWeek, Side } from '../db/schedulesSchema.js';
import { wait } from '../8sleep/promises.js';
import type { CancelableWait } from '../8sleep/promises.js';

// Tracks scheduled alarms per side from the moment their job fires until
// they stop ringing, so a power-off in the same minute can let them ring
// first. Without this, whichever job node-schedule ran first won: a power-off
// that ran first left the alarm to find the side off and skip.

// A due alarm job normally starts within milliseconds of the power-off.
const ALARM_START_WAIT_MS = 60_000;
// Longest a power-off waits for ringing alarms: the 300 s alarm maximum plus
// the time a scheduled alarm may spend reaching the hardware.
const ALARM_RING_WAIT_MS = 8 * 60_000;

const ringing = new Map<Side, Map<Promise<void>, string>>();
const starts = new EventEmitter();
// Aborting ends every wait at once, so shutdown can turn sides off promptly.
let pendingWaits = new AbortController();

const isAlarmJob = (side: Side, name: string) =>
  name.startsWith(`${side}-`) && (name.endsWith('-alarm') || name.includes('-alarm-override-'));

const isRecurring = (name: string) => !name.includes('-alarm-override-') && !name.endsWith('-one-off-alarm');

// Runs a scheduled alarm job. run resolves to how long the alarm rings, or 0
// when it did not ring. Call it first thing in the job so a power-off never
// sees the job as neither due nor started.
export function trackAlarm(side: Side, jobName: string, run: () => Promise<number>): Promise<void> {
  const result = run();
  const done = result
    .then(ringMs => (ringMs > 0 ? wait(ringMs) : undefined))
    .catch(() => undefined);
  const sideRinging = ringing.get(side) ?? new Map<Promise<void>, string>();
  ringing.set(side, sideRinging);
  sideRinging.set(done, jobName);
  void done.finally(() => sideRinging.delete(done));
  starts.emit(jobName);
  return result.then(() => undefined);
}

// Waits for the alarms of the night ending now, on this side, that are due in
// the same minute as a power-off or already ringing, to finish. The due check
// runs before the first await, while node-schedule still lists the alarm's
// pending run. A recurring alarm belongs to the night named by day; an alarm
// on another day's schedule starts that day's night and is left out.
export async function letAlarmsFinish(side: Side, day: DayOfWeek, fireDate: Date) {
  const { signal } = pendingWaits;
  const minuteStart = Math.floor(fireDate.getTime() / 60_000) * 60_000;
  const endsThisNight = (name: string) => isAlarmJob(side, name)
    && (!isRecurring(name) || name.startsWith(`${side}-${day}-`));
  const due = Object.values(schedule.scheduledJobs).filter(job => {
    if (!endsThisNight(job.name)) return false;
    const next = job.nextInvocation()?.getTime();
    return next !== undefined && next >= minuteStart && next < minuteStart + 60_000;
  });
  const limits: CancelableWait[] = [];
  const timed = (ms: number) => {
    const limit = wait(ms);
    limits.push(limit);
    return limit;
  };
  const aborted = new Promise<void>(resolve => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  const waitForStarts = Promise.all(due.map(job => new Promise<void>(resolve => {
    const limit = timed(ALARM_START_WAIT_MS);
    const done = () => {
      limit.cancel();
      starts.off(job.name, done);
      resolve();
    };
    void limit.then(done);
    starts.on(job.name, done);
  })));
  const waitForRinging = async () => {
    await waitForStarts;
    const running = [...(ringing.get(side) ?? [])].filter(([, name]) => endsThisNight(name)).map(([done]) => done);
    await Promise.race([Promise.all(running), timed(ALARM_RING_WAIT_MS)]);
  };
  await Promise.race([waitForRinging(), aborted]);
  limits.forEach(limit => limit.cancel());
}

// Ends every wait in progress, so the power-offs behind them go out at once.
export function abortAlarmWaits() {
  pendingWaits.abort();
  pendingWaits = new AbortController();
}

// Test isolation only: forget alarms whose ring timers a test never ran.
export function resetAlarmActivity() {
  ringing.clear();
}
