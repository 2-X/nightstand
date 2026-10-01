// Pure rules for a sleep that turns off when the person gets up. No server
// imports, so the file loads on its own.
import { SMART_OFF } from '../../db/smartOff.js';
import type { PresenceRun } from './confirmation.js';

const MINUTE = 60_000;
export const OUT_OF_BED_MS = SMART_OFF.outOfBedMinutes * MINUTE;
export const STEP_MS = 15 * MINUTE;
export const REARM_BEFORE_MS = 10 * MINUTE;
// The power-off job waits up to 9 minutes for alarms (one to start, eight to ring) before it asks.
export const DECISION_GRACE_MS = 12 * MINUTE;
// An alarm job can start a minute late; once it rings, the ringing check covers it.
export const ALARM_DUE_MS = 2 * MINUTE;
// Past the later analysis, two hours after the off.
export const OFF_MEMORY_MS = 26 * 60 * MINUTE;

export type OffReason = 'set-time' | 'stale' | 'no-room' | 'got-up' | 'cap' | 'side-off' | 'paused' | 'stopped' | 'not-decided';
export type Streak = { kind: 'absent'; since: number } | { kind: 'present' } | { kind: 'unknown' } | null;
export type SetOffDecision = 'extend' | Extract<OffReason, 'set-time' | 'stale' | 'no-room'>;

// An unbroken absence. After a gap in reports it counts from when they resumed.
export function stepStreak(previous: Streak, run: PresenceRun, now: number): Streak {
  if (!run.known) return { kind: 'unknown' };
  if (run.absentSince === null) return { kind: 'present' };
  // A newer change time means they were back in bed between two looks.
  if (previous?.kind === 'absent') return run.absentSince > previous.since ? { kind: 'absent', since: run.absentSince } : previous;
  return { kind: 'absent', since: previous?.kind === 'unknown' ? now : run.absentSince };
}

export function upFor(streak: Streak, now: number, opens: number): boolean {
  return streak?.kind === 'absent' && now - Math.max(streak.since, opens) >= OUT_OF_BED_MS;
}

// At the set off the side stays on only with room before the latest off,
// fresh presence and someone in bed; anything else is the set time.
export function decideAtSetOff(run: PresenceRun, setOff: Date, latest: Date): SetOffDecision {
  if (latest.getTime() <= setOff.getTime()) return 'no-room';
  if (!run.known) return 'stale';
  return run.presentSince === null ? 'set-time' : 'extend';
}

// Whether one of the sleep's own alarms, due by the set off, has yet to start ringing.
export function alarmAhead(alarms: readonly number[], now: number, setOff: number): boolean {
  return alarms.some(at => at <= setOff && now < at + ALARM_DUE_MS);
}

// The next firmware step's end, or null while the last one has more than
// 10 minutes left. Never past the latest off.
export function nextStep(armedUntil: number | null, now: number, latest: number): number | null {
  if (armedUntil !== null && armedUntil - now > REARM_BEFORE_MS) return null;
  const until = Math.min(now + STEP_MS, latest);
  return armedUntil !== null && until <= armedUntil ? null : until;
}
