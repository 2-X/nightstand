import { expect, it } from 'vitest';
import { temperatureColor } from '@lib/temperatureColor';
import { palette } from './tokens';

type Rgb = [number, number, number];
const parse = (color: string): Rgb & { alpha?: number } => {
  const rgba = color.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  if (rgba) return Object.assign([+rgba[1], +rgba[2], +rgba[3]] as Rgb, { alpha: +rgba[4] });
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as Rgb;
};
const over = (top: string, below: string): Rgb => {
  const fg = parse(top);
  const bg = parse(below);
  const alpha = fg.alpha ?? 1;
  return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
};
const luminance = ([r, g, b]: Rgb) => {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (top: string, below: string) => {
  const a = luminance(over(top, below));
  const b = luminance(parse(below));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

it('keeps Bed text at AA on its new surfaces', () => {
  expect(ratio(palette.text.secondary, palette.ember)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(palette.text.primary, palette.ember)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(palette.lamp, palette.power.nightBg)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(palette.text.tertiary, palette.bg.elevated)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(temperatureColor(10), palette.ember)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(temperatureColor(10), palette.bg.base)).toBeGreaterThanOrEqual(4.5);
});

it('keeps control boundaries at 3:1', () => {
  expect(ratio(palette.step.cool, palette.bg.base)).toBeGreaterThanOrEqual(3);
  expect(ratio(palette.step.warm, palette.bg.base)).toBeGreaterThanOrEqual(3);
  // Turn on's outline, against the black page around it and its own fill.
  expect(ratio(palette.tile.selectedBorder, palette.bg.base)).toBeGreaterThanOrEqual(3);
  expect(ratio(palette.tile.selectedBorder, palette.power.nightBg)).toBeGreaterThanOrEqual(3);
});
