import { expect, it } from 'vitest';
import { DEFAULT_SMART } from '@api/rhythmsSchema';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import { bedtimeNote, nightAnchors, previewCurves } from './smartPreview';

const TZ = 'America/Los_Angeles';
const workday = () => structuredClone(createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left.rhythms.workday.night);

it('anchors a night that crosses midnight', () => {
  const anchors = nightAnchors(workday(), '06:30', '2026-09-28', TZ);
  expect(anchors.bedtime.toISOString()).toBe('2026-09-29T05:30:00.000Z');
  expect(anchors.wake.toISOString()).toBe('2026-09-29T13:30:00.000Z');
  expect(anchors.powerOff.toISOString()).toBe('2026-09-29T13:45:00.000Z');
});

it('holds a wake time past the turn off at the turn off, with or without an alarm', () => {
  const night = workday();
  night.alarms = [{ ...night.alarm, enabled: false }];
  const anchors = nightAnchors(night, '12:00', '2026-09-28', TZ);
  expect(anchors.wake.toISOString()).toBe(anchors.powerOff.toISOString());
});

it('places a wake at the turn off at the end of a 24 hour night, as the Pod does', () => {
  const night = workday();
  night.power = { ...night.power, on: '22:00', off: '22:00' };
  const anchors = nightAnchors(night, '22:00', '2026-09-28', TZ);
  expect(anchors.bedtime.toISOString()).toBe('2026-09-29T05:00:00.000Z');
  expect(anchors.wake.toISOString()).toBe('2026-09-30T05:00:00.000Z');
  expect(anchors.wake.toISOString()).toBe(anchors.powerOff.toISOString());
});

it('shades how far the cool-down can move only with sleep tracking', () => {
  const night = workday();
  const clockOnly = previewCurves({ night, wake: '06:30', smart: DEFAULT_SMART, date: '2026-09-28', timeZone: TZ, trackingOn: false });
  expect(clockOnly.points.length).toBeGreaterThan(1);
  expect(clockOnly.band).toBeUndefined();
  const tracked = previewCurves({ night, wake: '06:30', smart: DEFAULT_SMART, date: '2026-09-28', timeZone: TZ, trackingOn: true });
  expect(tracked.band).toBeDefined();
  expect(tracked.band!.from.getTime()).toBeGreaterThanOrEqual(tracked.anchors.bedtime.getTime());
  expect(tracked.band!.to.getTime()).toBeGreaterThan(tracked.band!.from.getTime());
  expect(tracked.band!.to.getTime()).toBeLessThanOrEqual(tracked.anchors.wake.getTime());
});

it('says the bed starts warming only when the pre-warm is above neutral', () => {
  const night = workday();
  const note = (smart: Partial<typeof DEFAULT_SMART>) => bedtimeNote(previewCurves({
    night, wake: '06:30', smart: { ...DEFAULT_SMART, ...smart }, date: '2026-09-28', timeZone: TZ, trackingOn: false,
  }).points, TZ);
  expect(note({})).toBe('The bed starts warming at 10:00 PM.');
  expect(note({ warmStart: false })).toBe('The bed turns on at 10:00 PM.');
  expect(note({ warmStart: false, baseLevel: 5 })).toBe('The bed starts warming at 10:00 PM.');
  expect(note({ baseLevel: -7 })).toBe('The bed turns on at 10:00 PM.');
});
