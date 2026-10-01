import moment from 'moment-timezone';
import { isAlarmPaused, isSchedulePaused } from '../schedulePause.js';
import { effectiveSides } from '../scheduleQueries.js';
// Same rule as the weekly alarm job: an unexpired override, or one that
// expired inside this sleep, skips the sleep's own alarms.
export function isAlarmOverridden(settings, side, sleep, now) {
    const { expiresAt } = settings[side].scheduleOverrides.alarm;
    if (!expiresAt)
        return false;
    const expires = moment(expiresAt);
    if (!expires.isValid())
        return false;
    if (expires.isAfter(now))
        return true;
    return expires.isAfter(sleep.start) && expires.isSameOrBefore(sleep.end);
}
export function rhythmSkipReason(settings, side, sleep, kind, now, dueAt = now) {
    if (effectiveSides(settings, side).length === 0)
        return 'away';
    if (kind === 'analysis')
        return null;
    // An alarm due exactly at the end of a pause stays silent, so it is judged
    // at the time it was due rather than the time the job started.
    const paused = kind === 'alarm' ? isAlarmPaused(settings, side, dueAt) : isSchedulePaused(settings, side, now);
    if (paused)
        return 'paused';
    if (kind !== 'alarm')
        return null;
    if (!settings[side].alarmsEnabled)
        return 'alarms-off';
    return isAlarmOverridden(settings, side, sleep, now) ? 'alarm-override' : null;
}
//# sourceMappingURL=gates.js.map