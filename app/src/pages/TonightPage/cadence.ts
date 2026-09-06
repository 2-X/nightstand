import type { Recurrence } from '@api/schedulesSchema.ts';

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Human-readable cadence chip label for a recurrence rule.
export function cadenceLabel(recurrence: Recurrence): string {
  switch (recurrence.kind) {
  case 'daily':
    return 'Every day';
  case 'weekdays':
    return 'Mon–Fri';
  case 'weekends':
    return 'Sat–Sun';
  case 'customDays': {
    const days = [...recurrence.days].sort((a, b) => a - b);
    // Recognize the common groupings even when expressed as customDays.
    const set = new Set(days);
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Mon–Fri';
    if (days.length === 2 && set.has(0) && set.has(6)) return 'Sat–Sun';
    return days.map((d) => DAY_ABBR[d]).join(' ');
  }
  case 'everyNDays':
    return recurrence.n === 1 ? 'Every day' : `Every ${recurrence.n} days`;
  }
}
