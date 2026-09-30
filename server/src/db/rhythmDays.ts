// Shared by server and app: no node-only imports.
import type { DayOfWeek } from './schedulesSchema.js';

export const WEEK_DAYS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MAX_NAME_LENGTH = 24;
const WEEKNIGHTS: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const shortDayName = (day: DayOfWeek) => capital(day.slice(0, 3));
export const fullDayName = (day: DayOfWeek) => capital(day);

// Consecutive days, Sunday first. A run across Saturday and Sunday is joined only while it stays 3 days or shorter.
export function dayRuns(days: DayOfWeek[]): DayOfWeek[][] {
  const runs: DayOfWeek[][] = [];
  for (const [index, day] of WEEK_DAYS.entries()) {
    if (!days.includes(day)) continue;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === WEEK_DAYS[index - 1]) last.push(day);
    else runs.push([day]);
  }
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (runs.length > 1 && first[0] === 'sunday' && last[last.length - 1] === 'saturday' && first.length + last.length <= 3) {
    runs.shift();
    last.push(...first);
  }
  return runs;
}

// One wording for the week list, "Used on", undo lines and converted names.
export function describeDays(days: DayOfWeek[]): string {
  const chosen = WEEK_DAYS.filter(day => days.includes(day));
  if (!chosen.length) return '';
  if (chosen.length === 7) return 'Every day';
  // Six chosen days leave exactly one out.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (chosen.length === 6) return `Every day but ${shortDayName(WEEK_DAYS.find(day => !chosen.includes(day))!)}`;
  if (chosen.length === 1) return fullDayName(chosen[0]);
  const items = dayRuns(chosen).flatMap(run => run.length >= 3
    ? [`${shortDayName(run[0])} to ${shortDayName(run[run.length - 1])}`] : run.map(shortDayName));
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// The name a converted night gets from the days that share it.
export function conversionName(days: DayOfWeek[]): string {
  const chosen = WEEK_DAYS.filter(day => days.includes(day));
  if (chosen.length === 7) return 'Every night';
  if (chosen.length === WEEKNIGHTS.length && WEEKNIGHTS.every(day => chosen.includes(day))) return 'Weeknights';
  const name = describeDays(chosen).replace(/^Every day/, 'Every night');
  return name.length > MAX_NAME_LENGTH ? name.replace(' and ', ', ') : name;
}
