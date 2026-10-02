import { expect, it } from 'vitest';
import {
  BAND_RADIUS, HAND, STEPPER_POSITION, bandSegments, clampLevel, dialPoint, fillRange, levelAngle, offArc, radialLine, ticks,
} from './dialGeometry';

it('spreads -10..+10 over 200 degrees with 0 at 12 o\'clock', () => {
  expect(levelAngle(-10)).toBe(170);
  expect(levelAngle(0)).toBe(270);
  expect(levelAngle(10)).toBe(370);
  expect(levelAngle(-12)).toBe(150);
  expect(levelAngle(12)).toBe(390);
});

it('places points on the band centreline', () => {
  const top = dialPoint(0);
  expect(top.x).toBeCloseTo(170);
  expect(top.y).toBeCloseTo(170 - BAND_RADIUS);
  const left = dialPoint(-12);
  expect(left.x).toBeCloseTo(43.56, 2);
  expect(left.y).toBeCloseTo(243, 5);
  const right = dialPoint(12);
  expect(right.x).toBeCloseTo(296.44, 2);
  expect(right.y).toBeCloseTo(243, 5);
});

it('puts the steppers on the band ends, as shares of the dial box', () => {
  expect(STEPPER_POSITION).toEqual({ left: '12.81%', right: '87.19%', top: '79.41%' });
});

it('clamps levels to the scale and reads a bad value as 0', () => {
  expect(clampLevel(14)).toBe(10);
  expect(clampLevel(-11)).toBe(-10);
  expect(clampLevel(Number.NaN)).toBe(0);
  expect(clampLevel(3)).toBe(3);
});

it('cuts the band into 2 degree arcs that overlap the next and end on the target', () => {
  const segments = bandSegments(0, 3);
  expect(segments).toHaveLength(15);
  expect(segments[0].d.startsWith('M 170 24 A 146 146 0 0 1 ')).toBe(true);
  const end = dialPoint(3);
  expect(segments[14].d.endsWith(`${Math.round(end.x * 100) / 100} ${Math.round(end.y * 100) / 100}`)).toBe(true);
  expect(segments[0].level).toBeCloseTo(0.13);
  expect(bandSegments(-12, 12)).toHaveLength(120);
});

it('draws the off track as one arc across the whole band', () => {
  expect(offArc()).toBe('M 43.56 243 A 146 146 0 1 1 296.44 243');
});

it('fills from 0 toward the target and not at all at 0', () => {
  expect(fillRange(3)).toEqual([0, 3]);
  expect(fillRange(-3)).toEqual([-3, 0]);
  expect(fillRange(0)).toBeUndefined();
  expect(fillRange(14)).toEqual([0, 10]);
});

it('runs the hand 6 units past each band edge', () => {
  expect(HAND).toEqual({ inner: 131, outer: 161 });
  expect(radialLine(0, HAND.inner, HAND.outer)).toEqual({ x1: 170, y1: 39, x2: 170, y2: 9 });
});

it('marks 21 ticks inside the band, longer every 5 levels', () => {
  const all = ticks();
  expect(all).toHaveLength(21);
  expect(all.filter(tick => tick.major).map(tick => tick.level)).toEqual([-10, -5, 0, 5, 10]);
  expect(all[10]).toEqual({ level: 0, major: true, x1: 170, y1: 41, x2: 170, y2: 52 });
  expect(all[11]).toMatchObject({ level: 1, major: false });
});
