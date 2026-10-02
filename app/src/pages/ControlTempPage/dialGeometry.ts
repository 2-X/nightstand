// The ring is drawn in a 340 x 340 viewBox. Angles are SVG angles: 0 at +x, clockwise.
export const DIAL_VIEWBOX = 340;
const CENTER = DIAL_VIEWBOX / 2;
// The dial box is the ring's square plus room for the stepper labels under the ring's ends.
export const DIAL_ASPECT = 0.9;
export const BAND_RADIUS = 146;
export const BAND_WIDTH = 18;
const SCALE_MIN = -10;
const SCALE_MAX = 10;
// The band runs two levels past each end of the scale, under the steppers.
export const RUNWAY_LEVEL = 12;
export const HAND = { inner: BAND_RADIUS - BAND_WIDTH / 2 - 6, outer: BAND_RADIUS + BAND_WIDTH / 2 + 6 };
export const NOTCH = { inner: 116, outer: 131 };

const round = (value: number) => Math.round(value * 100) / 100;

export function levelAngle(level: number): number {
  return 270 + level * 10;
}

export function dialPoint(level: number, radius = BAND_RADIUS): { x: number; y: number } {
  const radians = levelAngle(level) * Math.PI / 180;
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) };
}

export function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.max(SCALE_MIN, Math.min(SCALE_MAX, level)) : 0;
}

const arc = (from: number, to: number, large: 0 | 1) => {
  const start = dialPoint(from);
  const end = dialPoint(to);
  return `M ${round(start.x)} ${round(start.y)} A ${BAND_RADIUS} ${BAND_RADIUS} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`;
};

// Arcs of 2 degrees from `from` up to `to`, each overlapping the next by 30% so no seam shows.
// Each carries its middle level so it can take that level's scale colour.
export function bandSegments(from: number, to: number): Array<{ d: string; level: number }> {
  const count = Math.max(1, Math.ceil(Math.abs(to - from) * 5));
  return Array.from({ length: count }, (_, index) => {
    const a = from + (to - from) * index / count;
    const b = from + (to - from) * Math.min(count, index + 1.3) / count;
    return { d: arc(a, b, 0), level: (a + b) / 2 };
  });
}

export function offArc(): string {
  return arc(-RUNWAY_LEVEL, RUNWAY_LEVEL, 1);
}

// The fill grows from 0 toward the target: clockwise when warm, counter-clockwise when cool.
export function fillRange(target: number): [number, number] | undefined {
  const level = clampLevel(target);
  if (level === 0) return undefined;
  return level > 0 ? [0, level] : [level, 0];
}

export function radialLine(level: number, inner: number, outer: number) {
  const from = dialPoint(level, inner);
  const to = dialPoint(level, outer);
  return { x1: round(from.x), y1: round(from.y), x2: round(to.x), y2: round(to.y) };
}

export function ticks() {
  return Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, index) => {
    const level = SCALE_MIN + index;
    const major = level % 5 === 0;
    return { level, major, ...radialLine(level, 129, major ? 118 : 123) };
  });
}

const end = dialPoint(-RUNWAY_LEVEL);
export const STEPPER_POSITION = {
  left: `${round(end.x / DIAL_VIEWBOX * 100)}%`,
  right: `${round(100 - end.x / DIAL_VIEWBOX * 100)}%`,
  top: `${round(end.y / (DIAL_VIEWBOX * DIAL_ASPECT) * 100)}%`,
};
