import type { AlarmJob, Side } from '../db/schedulesSchema.js';

// What a ringing alarm was started with. Each start stores a new object, so
// the object also tells one ring apart from the next.
export type ActiveAlarm = Pick<AlarmJob, 'vibrationIntensity' | 'duration' | 'vibrationPattern'>;

export const activeAlarms = new Map<Side, ActiveAlarm>();

const snoozes = new Map<Side, ReturnType<typeof setTimeout>>();

export function hasSnooze(side: Side): boolean {
  return snoozes.has(side);
}

export function cancelSnooze(side: Side): void {
  clearTimeout(snoozes.get(side));
  snoozes.delete(side);
}

// Replaces any snooze already waiting on this side.
export function setSnooze(side: Side, delayMs: number, ring: () => void): void {
  cancelSnooze(side);
  const timer = setTimeout(() => {
    if (snoozes.get(side) !== timer) return;
    snoozes.delete(side);
    ring();
  }, delayMs);
  snoozes.set(side, timer);
}

// A dismissed alarm also ends its snooze.
export function forgetActiveAlarm(side: Side): void {
  activeAlarms.delete(side);
  cancelSnooze(side);
}
