import { expect, it } from 'vitest';
import { friendlyTimeZone } from './timeZone';

it.each(['America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'])('formats %s consistently', zone => {
  const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longGeneric' })
    .formatToParts(new Date()).find(part => part.type === 'timeZoneName')!.value;
  expect(friendlyTimeZone(zone)).toBe(`${name} (${zone.split('/').pop()!.replace(/_/g, ' ')})`);
});
it('preserves unknown time zones', () => expect(friendlyTimeZone('Unknown/Zone')).toBe('Unknown/Zone'));
