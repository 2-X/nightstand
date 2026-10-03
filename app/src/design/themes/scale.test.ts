import { describe, expect, it } from 'vitest';
import { THEMES } from '.';
import { scaleColor } from './scale';

const continuous = THEMES.lamp.palette.scale;
const stepped = THEMES.nightstand.palette.scale;

it('returns lowercase hex from either kind of scale', () => {
  for (const scale of [continuous, stepped]) {
    for (let level = -10; level <= 10; level++) expect(scaleColor(scale, level)).toMatch(/^#[0-9a-f]{6}$/);
  }
});

describe('the continuous scale', () => {
  it.each([[-10, '#5fa8e8'], [-5, '#8cc3ec'], [0, '#c4c9ce'], [5, '#f2b266'], [10, '#f07b4f']])(
    'uses the colour stop at level %s', (level, colour) => {
      expect(scaleColor(continuous, Number(level))).toBe(colour);
    },
  );
  it('interpolates fractional levels without rounding them first', () => {
    expect(scaleColor(continuous, -7.5)).toBe('#76b6ea');
    expect(scaleColor(continuous, 2.5)).toBe('#dbbe9a');
    expect(scaleColor(continuous, 0.25)).not.toBe(scaleColor(continuous, 0));
  });
  it('clamps inputs and uses neutral for an unknown level', () => {
    expect(scaleColor(continuous, -100)).toBe(scaleColor(continuous, -10));
    expect(scaleColor(continuous, 100)).toBe(scaleColor(continuous, 10));
    expect(scaleColor(continuous, NaN)).toBe(scaleColor(continuous, 0));
  });
});

describe('a continuous scale that stops short of the ends', () => {
  const short = { kind: 'continuous', stops: [[-5, '#5FA8E8'], [0, '#C4C9CE'], [5, '#F07B4F']] } as const;
  it('holds its end colours past its last stops', () => {
    expect(scaleColor(short, -10)).toBe('#5fa8e8');
    expect(scaleColor(short, 10)).toBe('#f07b4f');
  });
});

describe('the stepped scale', () => {
  it.each([
    [-10, '#2196f3'], [-5, '#2196f3'], [-4, '#5393ff'], [-1, '#5393ff'], [0, '#e8eaed'],
    [1, '#e26464'], [4, '#e26464'], [5, '#f25555'], [10, '#f25555'],
  ])('puts level %s in the band it had, with zero neutral', (level, colour) => {
    expect(scaleColor(stepped, Number(level))).toBe(colour);
  });
  it('keeps the half level either side of zero neutral', () => {
    expect(scaleColor(stepped, 0.4)).toBe('#e8eaed');
    expect(scaleColor(stepped, -0.4)).toBe('#e8eaed');
    expect(scaleColor(stepped, 0.5)).toBe('#e26464');
    expect(scaleColor(stepped, -0.5)).toBe('#5393ff');
  });
  it('clamps inputs and uses neutral for an unknown level', () => {
    expect(scaleColor(stepped, -100)).toBe(scaleColor(stepped, -10));
    expect(scaleColor(stepped, 100)).toBe(scaleColor(stepped, 10));
    expect(scaleColor(stepped, NaN)).toBe('#e8eaed');
  });
});
