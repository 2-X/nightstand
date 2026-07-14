import { describe, expect, it } from 'vitest';
import { computeBedSpine, quiltMarks, scaleVisualDeg } from './bedGeometry.ts';

const CFG = { headPivotX: 180, feetPivotX: 220, baselineY: 90, segmentLen: 150 };

describe('scaleVisualDeg', () => {
  it('maps the physical range onto the visual range linearly', () => {
    expect(scaleVisualDeg(0, 45, 34)).toBe(0);
    expect(scaleVisualDeg(45, 45, 34)).toBe(34);
    expect(scaleVisualDeg(22.5, 45, 34)).toBeCloseTo(17, 5);
  });

  it('clamps below zero and above the physical max', () => {
    expect(scaleVisualDeg(-10, 45, 34)).toBe(0);
    expect(scaleVisualDeg(999, 45, 34)).toBe(34);
  });
});

describe('computeBedSpine', () => {
  it('at 0/0 both tips sit on the baseline, fully extended', () => {
    const { headTip, feetTip, headPivot, feetPivot } = computeBedSpine(0, 0, CFG);
    expect(headTip).toEqual({ x: CFG.headPivotX - CFG.segmentLen, y: CFG.baselineY });
    expect(feetTip).toEqual({ x: CFG.feetPivotX + CFG.segmentLen, y: CFG.baselineY });
    expect(headPivot).toEqual({ x: CFG.headPivotX, y: CFG.baselineY });
    expect(feetPivot).toEqual({ x: CFG.feetPivotX, y: CFG.baselineY });
  });

  it('raising the head angle lifts the head tip and pulls it inward, feet stay flat', () => {
    const { headTip, feetTip } = computeBedSpine(30, 0, CFG);
    expect(headTip.y).toBeLessThan(CFG.baselineY); // lifted
    expect(headTip.x).toBeGreaterThan(CFG.headPivotX - CFG.segmentLen); // pulled inward
    expect(feetTip).toEqual({ x: CFG.feetPivotX + CFG.segmentLen, y: CFG.baselineY });
  });

  it('the pillow sits between the head pivot and tip, closer to the tip', () => {
    const { headPivot, headTip, pillow } = computeBedSpine(30, 0, CFG);
    // pillowFraction defaults to 0.7, so pillow should be 70% of the way
    // from the pivot to the tip along both axes.
    expect(pillow.x).toBeCloseTo(headPivot.x + (headTip.x - headPivot.x) * 0.7, 5);
    expect(pillow.y).toBeCloseTo(headPivot.y + (headTip.y - headPivot.y) * 0.7, 5);
  });

  it('spinePath traces head tip -> head pivot -> feet pivot -> feet tip', () => {
    const spine = computeBedSpine(10, 5, CFG);
    expect(spine.spinePath).toBe(
      `M ${spine.headTip.x} ${spine.headTip.y} `
      + `L ${spine.headPivot.x} ${spine.headPivot.y} `
      + `L ${spine.feetPivot.x} ${spine.feetPivot.y} `
      + `L ${spine.feetTip.x} ${spine.feetTip.y}`,
    );
  });
});

describe('quiltMarks', () => {
  it('returns `count` marks, evenly spaced and perpendicular to the segment', () => {
    const marks = quiltMarks({ x: 0, y: 0 }, { x: 100, y: 0 }, 3, 10);
    expect(marks).toHaveLength(3);
    // Segment is horizontal, so each mark should be a vertical tick centred
    // on the segment (perpendicular to a horizontal line is vertical).
    marks.forEach((m) => {
      expect(m.x1).toBeCloseTo(m.x2, 5);
      expect(Math.abs(m.y1 - m.y2)).toBeCloseTo(20, 5);
    });
    expect(marks[0].x1).toBeCloseTo(25, 5);
    expect(marks[1].x1).toBeCloseTo(50, 5);
    expect(marks[2].x1).toBeCloseTo(75, 5);
  });

  it('returns no marks for a zero-length segment', () => {
    expect(quiltMarks({ x: 5, y: 5 }, { x: 5, y: 5 }, 3, 10)).toEqual([]);
  });
});
