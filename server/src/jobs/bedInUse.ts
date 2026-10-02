import { getDeviceStatusCoalesced, isFrankenConnected } from '../8sleep/frankenServer.js';
import { alarmsDueWithin } from './alarmLedger.js';

// Why an update, rollback or switch might disturb someone in bed. Unknown
// counts as in use, so a check that cannot read the bed never waves it on.
export type InUseReason = 'left-on' | 'right-on' | 'alarm-soon' | 'status-unknown';
export const ALARM_SOON_MS = 15 * 60_000;

export function alarmDueWithin(now: Date, windowMs: number): boolean {
  return alarmsDueWithin(now, windowMs).alarms.length > 0;
}

export async function bedInUseReasons(now = new Date()): Promise<InUseReason[]> {
  const reasons: InUseReason[] = [];
  const unknown = () => {
    if (!reasons.includes('status-unknown')) reasons.unshift('status-unknown');
  };
  try {
    if (!isFrankenConnected()) throw new Error('not connected');
    const status = await getDeviceStatusCoalesced();
    if (typeof status.left.isOn !== 'boolean' || typeof status.right.isOn !== 'boolean') throw new Error('unreadable state');
    if (status.left.isOn) reasons.push('left-on');
    if (status.right.isOn) reasons.push('right-on');
  } catch {
    unknown();
  }
  try {
    const { alarms, known } = alarmsDueWithin(now, ALARM_SOON_MS);
    if (!known) unknown();
    if (alarms.length > 0) reasons.push('alarm-soon');
  } catch {
    unknown();
  }
  return reasons;
}
