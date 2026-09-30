import type { Settings } from '../db/settingsSchema.js';
import type { Side } from '../db/schedulesSchema.js';

// Shared with the app, so it imports types only. Settings saved before pause
// existed have no pause object, which reads as not paused.

export function pauseEndsAt(settings: Settings, side: Side): Date | null {
  const pause = settings[side]?.scheduleOverrides?.pause;
  if (!pause?.active || !pause.expiresAt) return null;
  const end = Date.parse(pause.expiresAt);
  return Number.isFinite(end) ? new Date(end) : null;
}

// The end is exclusive: an event scheduled exactly at expiresAt runs.
export function isSchedulePaused(settings: Settings, side: Side, now: Date): boolean {
  const pause = settings[side]?.scheduleOverrides?.pause;
  if (!pause?.active) return false;
  if (!pause.expiresAt) return true;
  const end = pauseEndsAt(settings, side);
  return end !== null && now.getTime() < end.getTime();
}

// Alarms only: one due exactly at expiresAt is silenced too, so a paused
// sleeper is not woken as the pause ends. Power and temperature events at
// the end still run (isSchedulePaused). Pass the time the alarm was due.
export function isAlarmPaused(settings: Settings, side: Side, dueAt: Date): boolean {
  const pause = settings[side]?.scheduleOverrides?.pause;
  if (!pause?.active) return false;
  if (!pause.expiresAt) return true;
  const end = pauseEndsAt(settings, side);
  return end !== null && dueAt.getTime() <= end.getTime();
}

export function describePause(settings: Settings, side: Side): string {
  const end = pauseEndsAt(settings, side);
  return end ? `until ${end.toISOString()}` : 'until resumed';
}
