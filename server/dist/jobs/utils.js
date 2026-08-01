import logger from '../logger.js';
export const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function getDayOfWeekIndex(day) {
    return DAYS_OF_WEEK.indexOf(day);
}
function getNextDayOfWeekIndex(day) {
    const dayIndex = getDayOfWeekIndex(day);
    if (dayIndex === 6)
        return 0;
    return dayIndex + 1;
}
// Guards schedule data that predates API validation or was edited by hand.
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function isValidTime(time) {
    return typeof time === 'string' && TIME_PATTERN.test(time);
}
function toMinutes(time) {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
}
export function compareTimes(a, b) {
    return toMinutes(a) - toMinutes(b);
}
// A schedule wraps past midnight when its off time is not strictly later in
// the day than its on time. An off equal to on means a full 24 hour window,
// which also lands on the following day.
export function scheduleWrapsToNextDay(power) {
    return compareTimes(power.off, power.on) <= 0;
}
// A day's schedule opens at power.on on that day, so any time at or after
// power.on belongs to it and anything earlier falls on the following day.
// Deriving the day from power.on (rather than a fixed hour cutoff) keeps the
// power off, alarm, and temperature jobs of one night on the same night, and
// matches the window the app's schedule chart draws.
export function getDayIndexForTime(scheduleDay, time, powerOn) {
    return compareTimes(time, powerOn) >= 0
        ? getDayOfWeekIndex(scheduleDay)
        : getNextDayOfWeekIndex(scheduleDay);
}
export function getPowerOffDayIndex(scheduleDay, power) {
    return scheduleWrapsToNextDay(power)
        ? getNextDayOfWeekIndex(scheduleDay)
        : getDayOfWeekIndex(scheduleDay);
}
export function logJob(message, side, day, dayIndex, time) {
    const endDay = DAYS_OF_WEEK[dayIndex];
    // Say which night the job belongs to based on the day actually resolved,
    // rather than guessing from the hour, so the log agrees with the schedule.
    const timeOfDay = endDay === day ? 'night' : 'morning';
    logger.debug(`${message} for ${side} side for ${day} -> ${endDay} -- ${endDay} ${timeOfDay} @ ${time}`);
}
//# sourceMappingURL=utils.js.map