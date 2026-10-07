import { expect, it } from 'vitest';
import { DEFAULT_SMART } from '@api/rhythmsSchema';
import type { CurvePoint } from '@api/smartCurve';
import { createDemoRhythms } from '../../../mocks/rhythmsMock';
import { bedtimeNote, curveSummary, nightAnchors, previewCurves } from './smartPreview';

const TZ = 'America/Los_Angeles';
const workday = () => structuredClone(createDemoRhythms(new Date('2026-09-28T19:00:00Z')).left.rhythms.workday.night);

it.each([
  { levels: [2, -1, -2, 1], expected: '2 at bedtime, -2 overnight, 1 at wake-up' },
  { levels: [0, 0, 0, 1], expected: '0 at bedtime, 0 overnight, 1 at wake-up' },
  { levels: [1, -2, -3], expected: '1 at bedtime, -3 overnight, -3 at wake-up' },
])('summarizes hand-made levels $levels', ({ levels, expected }) => {
  const bedtime = new Date('2026-09-28T20:00:00Z');
  const wake = new Date('2026-09-29T06:00:00Z');
  const points: CurvePoint[] = levels.map((level, index) => ({ level,
    at: [bedtime, new Date('2026-09-28T21:00:00Z'), new Date('2026-09-29T02:00:00Z'), wake][index],
    phase: (['bedtime', 'cooldown', 'hold', 'wake'] as const)[index] }));
  expect(curveSummary(points, String, { bedtime, wake, scheduledWake: wake, powerOff: wake })).toBe(expected);
});

it.each(['standard', 'gentle'] as const)('keeps wake at bedtime through the spring gap with %s intensity', intensity => {
  const night = workday();
  night.power = { ...night.power, on: '02:50', off: '04:00' };
  const preview = previewCurves({ night, wake: '03:20', smart: { ...DEFAULT_SMART, intensity, warmUp: false },
    date: '2026-03-08', timeZone: TZ, trackingOn: true });
  expect(preview.anchors.bedtime.toISOString()).toBe('2026-03-08T10:50:00.000Z');
  expect(preview.anchors.wake).toEqual(preview.anchors.bedtime);
  expect(preview.domain.from <= preview.markers.wake).toBe(true);
  expect(preview.series.map(point => point.at.toISOString())).toEqual([
    intensity === 'standard' ? '2026-03-08T10:20:00.000Z' : '2026-03-08T10:30:00.000Z', '2026-03-08T10:50:00.000Z',
    '2026-03-08T10:50:00.000Z', '2026-03-08T11:00:00.000Z',
  ]);
});

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

it('summarizes the held level at wake when turn off removes the wake command', () => {
  const night = workday();
  night.power = { ...night.power, on: '20:00', off: '08:00' };
  const preview = previewCurves({ night, wake: '08:00', smart: { ...DEFAULT_SMART, warmUp: false },
    date: '2026-09-28', timeZone: TZ, trackingOn: true });
  expect(preview.points[preview.points.length - 1]?.at.toISOString()).toBe('2026-09-29T04:10:00.000Z');
  expect(curveSummary(preview.points, String, preview.anchors)).toBe('2 at bedtime, -2 overnight, -2 at wake-up');
});

it('keeps the planned Wake marker when an unfinished draft turns off earlier', () => {
  const night = workday();
  night.power = { ...night.power, on: '20:00', off: '07:00' };
  const preview = previewCurves({ night, wake: '08:00', smart: { ...DEFAULT_SMART, warmUp: false },
    date: '2026-09-28', timeZone: TZ, trackingOn: true });
  expect(preview.markers.wake.toISOString()).toBe('2026-09-29T15:00:00.000Z');
  expect(preview.domain.to).toEqual(preview.markers.wake);
  expect(preview.series[preview.series.length - 1].at).toEqual(preview.anchors.powerOff);
});

it('omits a spring-forward draft whose turn off precedes its shifted bedtime', () => {
  const night = workday();
  night.power = { ...night.power, on: '02:05', off: '03:04' };
  const preview = previewCurves({ night, wake: '07:34', smart: DEFAULT_SMART,
    date: '2026-03-08', timeZone: TZ, trackingOn: false });
  expect(preview.anchors.powerOff < preview.anchors.bedtime).toBe(true);
  expect(preview.points).toEqual([]);
  expect(preview.series).toEqual([]);
  expect(curveSummary(preview.points, String, preview.anchors)).toBe('');
});

it('parses next-day clock times on their own date after the DST gap', () => {
  const night = workday();
  night.power = { ...night.power, on: '20:00', off: '03:00' };
  const anchors = nightAnchors(night, '02:15', '2026-03-08', TZ);
  expect(anchors.wake.toISOString()).toBe('2026-03-09T09:15:00.000Z');
});
