import { DayOfWeek } from '../db/schedulesSchema.js';

export const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function getDayOfWeekIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

export function getNextDayOfWeekIndex(day: DayOfWeek): number {
  const dayIndex = getDayOfWeekIndex(day);
  if (dayIndex === 6) return 0;
  return dayIndex;
}
