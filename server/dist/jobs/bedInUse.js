import { getDeviceStatusCoalesced, isFrankenConnected } from '../8sleep/frankenServer.js';
import { alarmsDueWithin } from './alarmLedger.js';
export const ALARM_SOON_MS = 15 * 60_000;
export function alarmDueWithin(now, windowMs) {
    return alarmsDueWithin(now, windowMs).alarms.length > 0;
}
export async function bedInUseReasons(now = new Date()) {
    const reasons = [];
    const unknown = () => {
        if (!reasons.includes('status-unknown'))
            reasons.unshift('status-unknown');
    };
    try {
        if (!isFrankenConnected())
            throw new Error('not connected');
        const status = await getDeviceStatusCoalesced();
        if (typeof status.left.isOn !== 'boolean' || typeof status.right.isOn !== 'boolean')
            throw new Error('unreadable state');
        if (status.left.isOn)
            reasons.push('left-on');
        if (status.right.isOn)
            reasons.push('right-on');
    }
    catch {
        unknown();
    }
    try {
        const { alarms, known } = alarmsDueWithin(now, ALARM_SOON_MS);
        if (!known)
            unknown();
        if (alarms.length > 0)
            reasons.push('alarm-soon');
    }
    catch {
        unknown();
    }
    return reasons;
}
//# sourceMappingURL=bedInUse.js.map