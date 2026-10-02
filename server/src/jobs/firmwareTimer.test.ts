import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firmwareSecondsUntil, secondsUntilScheduledOff, WEEKLY_FIRMWARE_MARGIN_SECONDS } from './firmwareTimer.js';
import { MAX_ON_DURATION_SECONDS } from '../routes/deviceStatus/deviceStatusSchema.js';

const LA = 'America/Los_Angeles';

describe('secondsUntilScheduledOff', () => {
  it('counts to the next off across midnight, plus the margin', () => {
    const on = new Date('2026-10-05T04:00:00Z'); // 21:00 Pacific
    assert.equal(secondsUntilScheduledOff(on, '07:00', LA), 10 * 3600 + WEEKLY_FIRMWARE_MARGIN_SECONDS);
  });
  it('counts to a later off on the same day', () => {
    const on = new Date('2026-10-05T20:00:00Z'); // 13:00 Pacific
    assert.equal(secondsUntilScheduledOff(on, '15:30', LA), 2.5 * 3600 + WEEKLY_FIRMWARE_MARGIN_SECONDS);
  });
  it('never exceeds the firmware maximum', () => {
    const on = new Date('2026-10-05T01:00:00Z'); // 18:00 Pacific
    assert.equal(secondsUntilScheduledOff(on, '09:00', LA), MAX_ON_DURATION_SECONDS);
  });
  it('uses real elapsed time across the spring daylight-saving change', () => {
    const on = new Date('2027-03-14T05:00:00Z'); // 21:00 PST, Mar 13
    assert.equal(secondsUntilScheduledOff(on, '07:00', LA), 9 * 3600 + WEEKLY_FIRMWARE_MARGIN_SECONDS);
  });
  it('treats an off equal to now as tomorrow, so the cap applies', () => {
    const on = new Date('2026-10-05T04:00:00Z');
    assert.equal(secondsUntilScheduledOff(on, '21:00', LA), MAX_ON_DURATION_SECONDS);
  });
});

describe('firmwareSecondsUntil', () => {
  it('falls back to the firmware maximum for an end that is not a time', () => {
    assert.equal(firmwareSecondsUntil(new Date(Number.NaN), new Date()), MAX_ON_DURATION_SECONDS);
  });
});
