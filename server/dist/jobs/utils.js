export const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function getDayOfWeekIndex(day) {
    return DAYS_OF_WEEK.indexOf(day);
}
export function getNextDayOfWeekIndex(day) {
    const dayIndex = getDayOfWeekIndex(day);
    if (dayIndex === 6)
        return 0;
    return dayIndex;
}
