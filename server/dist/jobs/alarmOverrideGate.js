import moment from 'moment-timezone';
import { nightBounds } from './nightBounds.js';
import { compareTimes } from './utils.js';
// Whether an alarm override replaces the weekly alarm at `time` when it is
// due at `at`. The night's original alarms stay silent after an earlier
// replacement, and an override that ended inside the night still counts.
export function alarmOverrideSilences(overrideExpiresAt, timeZone, time, power, at) {
    if (!overrideExpiresAt)
        return false;
    const expiresAt = moment.tz(overrideExpiresAt, timeZone);
    const date = at.clone().startOf('day');
    if (compareTimes(time, power.on) < 0)
        date.subtract(1, 'day');
    const { start: nightStart, end: nightEnd } = nightBounds(date, power);
    return expiresAt.isAfter(at) || expiresAt.isBetween(nightStart, nightEnd, undefined, '(]');
}
//# sourceMappingURL=alarmOverrideGate.js.map