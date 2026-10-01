import { expect, it } from 'vitest';
import { latestOff } from './smartOff.ts';

it('loads the shared latest-off rule in the app', () => {
  expect(latestOff({ setOff: new Date('2026-09-30T14:30:00Z') }).toISOString()).toBe('2026-09-30T17:30:00.000Z');
});
