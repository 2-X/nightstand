import moment from 'moment-timezone';
import type { Settings } from '../db/settingsSchema.js';

// The daily restart runs an hour before the daily prime. A prime at 00:30
// restarts at 23:30, not at an hour of -1, which node-schedule rejects
// silently so the Pod would simply stop restarting.
export function rebootClock(primeTime: string): { hour: number; minute: number } {
  const [hour, minute] = primeTime.split(':').map(Number);
  return { hour: (hour + 23) % 24, minute };
}

// The first daily restart after `after`, or null when the Pod does not restart daily.
export function nextReboot(settings: Pick<Settings, 'timeZone' | 'primePodDaily' | 'rebootDaily'>, after: Date): Date | null {
  const { timeZone, primePodDaily, rebootDaily } = settings;
  if (!timeZone || !primePodDaily.enabled || !rebootDaily) return null;
  const { hour, minute } = rebootClock(primePodDaily.time);
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  for (let days = 0; days <= 2; days++) {
    const date = moment.tz(after, timeZone).add(days, 'day').format('YYYY-MM-DD');
    const at = moment.tz(`${date} ${clock}`, 'YYYY-MM-DD HH:mm', true, timeZone);
    if (at.isAfter(after)) return at.toDate();
  }
  return null;
}
