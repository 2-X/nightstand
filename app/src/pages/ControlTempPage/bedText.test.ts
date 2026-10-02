import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import { clockText, lastKnownAt, staleCaption } from './bedText';

const at = new Date('2026-09-29T04:41:00Z');

it('writes a time in the Pod time zone, joined to its AM or PM', () => {
  expect(clockText(at, 'America/Los_Angeles')).toBe('9:41\u00a0PM');
  expect(clockText(at, 'UTC')).toBe('4:41\u00a0AM');
});

it('falls back to the browser time zone without a Pod time zone', () => {
  expect(clockText(at, null)).toBe(moment(at).format('h:mm\u00a0A'));
});

it('says since when the Pod has not answered, and what that means for tonight', () => {
  expect(staleCaption(at, 'America/Los_Angeles')).toEqual([
    'No response from the Pod since 9:41\u00a0PM.',
    'Schedules and alarms may not run.',
  ]);
});

it('dates a last known value', () => {
  expect(lastKnownAt(at, 'America/Los_Angeles')).toBe('at 9:41\u00a0PM');
});
