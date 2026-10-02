import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { palette } from '@design/tokens';
import { temperatureColor } from '@lib/temperatureColor';
import DialRing from './DialRing';
import { HAND, NOTCH, bandSegments, offArc, radialLine } from './dialGeometry';

const ring = (isOn: boolean, targetLevel: number, currentLevel = 0) =>
  render(<DialRing isOn={ isOn } targetLevel={ targetLevel } currentLevel={ currentLevel }/>).container;
const attrs = (element: Element | null, ...names: string[]) => names.map(name => Number(element?.getAttribute(name)));

it('draws a quiet track with dim ticks and nothing else while off', () => {
  const container = ring(false, 3);
  const svg = container.querySelector('svg')!;
  expect(svg).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelector('path[data-band="off"]')).toHaveAttribute('d', offArc());
  expect(container.querySelector('path[data-band="off"]')).toHaveAttribute('stroke', palette.dial.track);
  expect(container.querySelectorAll('line[data-tick]')).toHaveLength(21);
  expect(container.querySelector('line[data-tick="major"]')).toHaveAttribute('stroke', palette.dial.tickMajorOff);
  for (const selector of ['g[data-band="ghost"]', 'g[data-band="fill"]', 'line[data-hand]', 'circle[data-glow]', 'line[data-notch]'])
    expect(container.querySelector(selector)).toBeNull();
});

it('fills clockwise from 0 to a warm target and puts the hand and glow there', () => {
  const container = ring(true, 3, 1);
  expect(container.querySelectorAll('g[data-band="ghost"] path')).toHaveLength(120);
  expect(container.querySelector('g[data-band="ghost"]')).toHaveAttribute('opacity', String(palette.dial.ghostOpacity));
  const fill = container.querySelectorAll('g[data-band="fill"] path');
  expect(fill).toHaveLength(15);
  expect(fill[0].getAttribute('d')!.startsWith('M 170 24 ')).toBe(true);
  const hand = radialLine(3, HAND.inner, HAND.outer);
  expect(attrs(container.querySelector('line[data-hand]'), 'x1', 'y1', 'x2', 'y2')).toEqual([hand.x1, hand.y1, hand.x2, hand.y2]);
  expect(container.querySelector('circle[data-glow]')).toHaveAttribute('fill', temperatureColor(3));
  const notch = radialLine(1, NOTCH.inner, NOTCH.outer);
  expect(attrs(container.querySelector('line[data-notch]'), 'x1', 'y1')).toEqual([notch.x1, notch.y1]);
});

it('fills counter-clockwise for a cool target', () => {
  const container = ring(true, -3, -1);
  const fill = container.querySelectorAll('g[data-band="fill"] path');
  expect(fill).toHaveLength(15);
  expect(fill[fill.length - 1].getAttribute('d')!.endsWith(' 170 24')).toBe(true);
  expect(fill[0]).toHaveAttribute('stroke', temperatureColor(bandSegments(-3, 0)[0].level));
});

it('leaves the band empty at 0 and stands the hand at 12 o\'clock', () => {
  const container = ring(true, 0);
  expect(container.querySelector('g[data-band="fill"]')).toBeNull();
  expect(attrs(container.querySelector('line[data-hand]'), 'x1', 'x2')).toEqual([170, 170]);
  expect(container.querySelector('circle[data-glow]')).toHaveAttribute('fill', temperatureColor(0));
});

it('keeps an out of range target on the scale', () => {
  const container = ring(true, 14);
  const hand = radialLine(10, HAND.inner, HAND.outer);
  expect(attrs(container.querySelector('line[data-hand]'), 'x1', 'y1')).toEqual([hand.x1, hand.y1]);
});
