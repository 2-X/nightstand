import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { palette } from '@design/tokens';
import { temperatureColor } from '@lib/temperatureColor';
import DialRing from './DialRing';
import { NOTCH, bandSegments, dialPoint, offArc, radialLine } from './dialGeometry';

const ring = (isOn: boolean, targetLevel: number, currentLevel = 0) =>
  render(<DialRing isOn={ isOn } targetLevel={ targetLevel } currentLevel={ currentLevel }/>).container;
const centre = (element: Element | null) => [Number(element?.getAttribute('cx')), Number(element?.getAttribute('cy'))];
const attrs = (element: Element | null, ...names: string[]) => names.map(name => Number(element?.getAttribute(name)));

it('draws a quiet track with dim ticks and dim end labels while off', () => {
  const container = ring(false, 3);
  const svg = container.querySelector('svg')!;
  expect(svg).toHaveAttribute('aria-hidden', 'true');
  expect(svg).toHaveAttribute('viewBox', '0 0 280 240');
  const track = container.querySelector('path[data-band="off"]');
  expect(track).toHaveAttribute('d', offArc());
  expect(track).toHaveAttribute('stroke', palette.dial.trackOff);
  expect(container.querySelectorAll('line[data-tick]')).toHaveLength(21);
  expect(container.querySelector('line[data-tick="major"]')).toHaveAttribute('stroke', palette.dial.tickMajorOff);
  const labels = container.querySelectorAll('text[data-end-label]');
  expect(Array.from(labels, label => label.textContent)).toEqual(['\u221210', '+10']);
  expect(labels[0]).toHaveAttribute('fill', palette.text.disabled);
  for (const selector of ['g[data-band="ghost"]', 'g[data-band="fill"]', 'line[data-notch]', 'circle[data-halo]', 'circle[data-target]'])
    expect(container.querySelector(selector)).toBeNull();
});

it('draws the whole scale faintly, a solid span from 0 to a warm target, and the dot there', () => {
  const container = ring(true, 3, 1);
  expect(container.querySelectorAll('g[data-band="ghost"] path')).toHaveLength(100);
  expect(container.querySelector('g[data-band="ghost"]')).toHaveAttribute('opacity', String(palette.dial.ghostOpacity));
  const fill = container.querySelectorAll('g[data-band="fill"] path');
  expect(fill).toHaveLength(15);
  expect(fill[0].getAttribute('d')!.startsWith('M 140 22 ')).toBe(true);
  const at = dialPoint(3);
  const target = container.querySelector('circle[data-target]');
  expect(centre(target)[0]).toBeCloseTo(at.x);
  expect(centre(target)[1]).toBeCloseTo(at.y);
  expect(target).toHaveAttribute('r', '8.5');
  expect(target).toHaveAttribute('fill', temperatureColor(3));
  const halo = container.querySelector('circle[data-halo]');
  expect(halo).toHaveAttribute('r', '14');
  expect(halo).toHaveAttribute('fill', 'none');
  expect(halo).toHaveAttribute('stroke', temperatureColor(3));
  expect(halo).toHaveAttribute('opacity', String(palette.dial.haloOpacity));
  expect(container.querySelector('text[data-end-label]')).toHaveAttribute('fill', palette.text.tertiary);
  expect(container.querySelector('line[data-tick="major"]')).toHaveAttribute('stroke', palette.dial.tickMajor);
});

it('spans counter-clockwise to a cool target', () => {
  const fill = ring(true, -3, -1).querySelectorAll('g[data-band="fill"] path');
  expect(fill).toHaveLength(15);
  expect(fill[fill.length - 1].getAttribute('d')!.endsWith(' 140 22')).toBe(true);
  expect(fill[0]).toHaveAttribute('stroke', temperatureColor(bandSegments(-3, 0)[0].level));
});

it('marks where the bed is now only while it differs from the target', () => {
  const notch = radialLine(1, NOTCH.inner, NOTCH.outer);
  expect(attrs(ring(true, 3, 1).querySelector('line[data-notch]'), 'x1', 'y1', 'x2', 'y2'))
    .toEqual([notch.x1, notch.y1, notch.x2, notch.y2]);
  expect(ring(true, 3, 3).querySelector('line[data-notch]')).toBeNull();
});

it('leaves the span empty at 0 and puts the dot at 12 o\'clock', () => {
  const container = ring(true, 0);
  expect(container.querySelector('g[data-band="fill"]')).toBeNull();
  const [x, y] = centre(container.querySelector('circle[data-target]'));
  expect(x).toBeCloseTo(140);
  expect(y).toBeCloseTo(22);
});

it('keeps an out of range target on the scale', () => {
  const at = dialPoint(10);
  expect(centre(ring(true, 14).querySelector('circle[data-target]'))[0]).toBeCloseTo(at.x);
});

it('marks the target with a flat halo, never a blur', () => {
  expect(ring(true, 3).querySelector('filter')).toBeNull();
});

it('draws the dot hollow until the Pod confirms the target', () => {
  const container = render(<DialRing isOn pending targetLevel={ 3 } currentLevel={ 1 }/>).container;
  const dot = container.querySelector('circle[data-target]');
  expect(dot).toHaveAttribute('data-pending');
  expect(dot).toHaveAttribute('r', '7.5');
  expect(dot).toHaveAttribute('fill', palette.bg.base);
  expect(dot).toHaveAttribute('stroke', temperatureColor(3));
  expect(ring(true, 3, 1).querySelector('circle[data-pending]')).toBeNull();
});

it('draws a last known target as a grey dot on the off track, with no span, notch or halo', () => {
  const container = render(<DialRing isOn stale targetLevel={ 3 } currentLevel={ 1 }/>).container;
  expect(container.querySelector('path[data-band="off"]')).not.toBeNull();
  for (const selector of ['g[data-band="ghost"]', 'g[data-band="fill"]', 'line[data-notch]', 'circle[data-halo]'])
    expect(container.querySelector(selector)).toBeNull();
  const dot = container.querySelector('circle[data-target]');
  expect(dot).toHaveAttribute('data-stale');
  expect(dot).toHaveAttribute('fill', palette.text.tertiary);
  expect(container.querySelector('line[data-tick="major"]')).toHaveAttribute('stroke', palette.dial.tickMajorOff);
  expect(container.querySelector('text[data-end-label]')).toHaveAttribute('fill', palette.text.disabled);
});

it('draws no dot for a side last known to be off', () => {
  expect(render(<DialRing isOn={ false } stale targetLevel={ 3 } currentLevel={ 1 }/>).container.querySelector('circle[data-target]'))
    .toBeNull();
});
