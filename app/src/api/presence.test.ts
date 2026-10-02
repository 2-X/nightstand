import { expect, it } from 'vitest';
import { PRESENCE_STALE_MS as SERVER_PRESENCE_STALE_MS } from '../../../server/src/8sleep/presenceStale';
import { PRESENCE_STALE_MS, isPresenceFresh } from './presence';

const now = Date.parse('2026-09-29T06:00:00Z');
const reported = (ago: number) => ({ present: true, lastUpdatedAt: new Date(now - ago).toISOString() });

it('trusts a presence report for five minutes', () => {
  expect(PRESENCE_STALE_MS).toBe(300_000);
  expect(isPresenceFresh(reported(0), now)).toBe(true);
  expect(isPresenceFresh(reported(PRESENCE_STALE_MS), now)).toBe(true);
  expect(isPresenceFresh(reported(PRESENCE_STALE_MS + 1), now)).toBe(false);
});

it('stops trusting presence when the server does', () => {
  expect(PRESENCE_STALE_MS).toBe(SERVER_PRESENCE_STALE_MS);
});

it('does not trust a report with no time, a bad time or a time well in the future', () => {
  expect(isPresenceFresh(undefined, now)).toBe(false);
  expect(isPresenceFresh({ present: true }, now)).toBe(false);
  expect(isPresenceFresh({ present: true, lastUpdatedAt: 'soon' }, now)).toBe(false);
  expect(isPresenceFresh(reported(-60_001), now)).toBe(false);
});

it('trusts a new report from a Pod whose clock is up to a minute ahead of the phone', () => {
  expect(isPresenceFresh(reported(-1), now)).toBe(true);
  expect(isPresenceFresh(reported(-60_000), now)).toBe(true);
});
