export interface Point {
  x: number;
  y: number;
}

export interface BedSpine {
  headPivot: Point;
  feetPivot: Point;
  headTip: Point;
  feetTip: Point;
  pillow: Point;
  spinePath: string;
}

export interface BedGeometryConfig {
  headPivotX: number;
  feetPivotX: number;
  baselineY: number;
  segmentLen: number;
  pillowFraction?: number;
}

function segmentTip(pivotX: number, baselineY: number, length: number, angleDeg: number, direction: 1 | -1): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: pivotX + direction * length * Math.cos(rad),
    y: baselineY - length * Math.sin(rad),
  };
}

// Two hinged panels either side of a fixed centre platform, matching how
// adjustable bases are actually built. headDeg/feetDeg are the VISUAL tilt
// angles already (see scaleVisualDeg) - this function does no clamping or
// physical-to-visual mapping of its own.
export function computeBedSpine(headDeg: number, feetDeg: number, cfg: BedGeometryConfig): BedSpine {
  const { headPivotX, feetPivotX, baselineY, segmentLen, pillowFraction = 0.7 } = cfg;
  const headPivot: Point = { x: headPivotX, y: baselineY };
  const feetPivot: Point = { x: feetPivotX, y: baselineY };
  const headTip = segmentTip(headPivotX, baselineY, segmentLen, headDeg, -1);
  const feetTip = segmentTip(feetPivotX, baselineY, segmentLen, feetDeg, 1);
  const pillow = segmentTip(headPivotX, baselineY, segmentLen * pillowFraction, headDeg, -1);

  const spinePath = `M ${headTip.x} ${headTip.y} `
    + `L ${headPivot.x} ${headPivot.y} `
    + `L ${feetPivot.x} ${feetPivot.y} `
    + `L ${feetTip.x} ${feetTip.y}`;

  return { headPivot, feetPivot, headTip, feetTip, pillow, spinePath };
}

// Maps a physical angle (e.g. 0-45 real degrees) onto a visual angle range,
// clamped to the physical range first. A short illustration segment needs an
// exaggerated tilt to read as motion at all, so the physical and visual
// ranges are deliberately different.
export function scaleVisualDeg(rawDeg: number, rawMax: number, maxVisualDeg: number): number {
  const clamped = Math.max(0, Math.min(rawMax, rawDeg));
  return (clamped / rawMax) * maxVisualDeg;
}

// A handful of perpendicular tick marks along a panel, evenly spaced between
// its pivot and tip, suggesting mattress channel-quilting. Deliberately a
// generic, evenly-spaced motif - not the clustered diagonal stripe used as
// Eight Sleep's vent-logo mark.
export function quiltMarks(pivot: Point, tip: Point, count: number, halfLen: number) {
  const dx = tip.x - pivot.x;
  const dy = tip.y - pivot.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const marks = [];
  for (let i = 1; i <= count; i++) {
    const f = i / (count + 1);
    const cx = pivot.x + dx * f;
    const cy = pivot.y + dy * f;
    marks.push({
      x1: cx - px * halfLen,
      y1: cy - py * halfLen,
      x2: cx + px * halfLen,
      y2: cy + py * halfLen,
    });
  }
  return marks;
}
