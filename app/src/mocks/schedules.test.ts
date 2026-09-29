import { expect, it } from 'vitest';
import { getSchedules, updateSchedules } from './mockData';

it('replaces removed temperatures when saving a day in the demo', () => {
  const original = structuredClone(getSchedules());
  try {
    const day = { ...original.left.monday, temperatures: { '23:00': 70 } };
    updateSchedules({ left: { ...original.left, monday: day } });
    expect(getSchedules().left.monday.temperatures).toEqual({ '23:00': 70 });
    updateSchedules({ left: { ...original.left, monday: { ...day, temperatures: {} } } });
    expect(getSchedules().left.monday.temperatures).toEqual({});
    expect(getSchedules().right).toEqual(original.right);
  } finally { updateSchedules(original); }
});
