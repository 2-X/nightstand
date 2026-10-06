import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import cases from '../../../fixtures/nightBounds.json';
import { nightBounds } from './nightBounds';

it.each(cases)('$name', fixture => {
  const { start, end } = nightBounds(moment.tz(fixture.date, fixture.zone), fixture.power);
  expect(start.format()).toBe(fixture.start);
  expect(end.format()).toBe(fixture.end);
});

it('sets the off time on the following date after the spring-forward change', () => {
  const { end } = nightBounds(moment.tz('2027-03-14', 'America/Los_Angeles'), { on: '21:00', off: '02:30' });
  expect(end.format()).toBe('2027-03-15T02:30:00-07:00');
});
