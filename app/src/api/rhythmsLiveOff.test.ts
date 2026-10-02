import { expect, it } from 'vitest';
import { RhythmsLiveReadSchema } from './rhythmsResponse';

const live = {
  side: 'left', date: '2026-09-28', phase: 'wake', waiting: false, coolStart: '2026-09-28T22:30:00.000Z',
  hold: null, baseSince: null, nextChange: null,
};

it('reads the latest turn-off of a "When I get up" sleep', () => {
  expect(RhythmsLiveReadSchema.parse({ ...live, offWhenUp: { by: '2026-09-29T09:45:00.000Z' } })?.offWhenUp)
    .toEqual({ by: '2026-09-29T09:45:00.000Z' });
});

it('reads a live state without it, and a malformed one as none', () => {
  expect(RhythmsLiveReadSchema.parse(live)?.offWhenUp).toBeUndefined();
  expect(RhythmsLiveReadSchema.parse({ ...live, offWhenUp: { by: 'soon' } })?.offWhenUp).toBeNull();
});
