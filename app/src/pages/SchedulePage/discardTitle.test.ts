import { expect, it } from 'vitest';
import { discardTitle } from './discardTitle';

const base = { day: 'Tuesday', otherDays: 0, sideChange: false, side: 'left' as const, sideName: 'Alex' };

it('names only the day for a day switch', () => {
  expect(discardTitle(base)).toBe('Discard changes to Tuesday?');
});

it('counts copied days', () => {
  expect(discardTitle({ ...base, otherDays: 1 })).toBe('Discard changes to Tuesday and 1 more day?');
  expect(discardTitle({ ...base, otherDays: 2 })).toBe('Discard changes to Tuesday and 2 more days?');
});

it('names the side for a side switch', () => {
  expect(discardTitle({ ...base, sideChange: true })).toBe("Discard changes to Alex's Tuesday?");
});

it('falls back to the side position when the side has no name', () => {
  expect(discardTitle({ ...base, sideChange: true, sideName: undefined })).toBe("Discard changes to the left side's Tuesday?");
  expect(discardTitle({ ...base, sideChange: true, sideName: '', side: 'right' })).toBe("Discard changes to the right side's Tuesday?");
});
