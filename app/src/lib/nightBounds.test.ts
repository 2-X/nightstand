import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import cases from '../../../fixtures/nightBounds.json';
import { nightBounds } from './nightBounds';

it.each(cases)('$name', fixture => {
  const { start, end } = nightBounds(moment.tz(fixture.date, fixture.zone), fixture.power);
  expect(start.format()).toBe(fixture.start);
  expect(end.format()).toBe(fixture.end);
});
