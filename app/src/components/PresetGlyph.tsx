import { computeBedSpine, scaleVisualDeg } from '@lib/bedGeometry.ts';

interface PresetGlyphProps {
  label: string;
  headDeg: number; // raw 0-45
  feetDeg: number; // raw 0-30
  active: boolean;
}

// A tiny static preview of BedVisualization's own geometry, so a preset
// button's icon always matches what pressing it will actually draw - no
// separate hand-authored SVG to keep in sync.
const VIEW_W = 100;
const BASELINE_Y = 24;
const HEAD_PIVOT_X = 45;
const FEET_PIVOT_X = 55;
const SEGMENT_LEN = 34;
const MAX_VISUAL_DEG = 30;

export default function PresetGlyph({ label, headDeg, feetDeg, active }: PresetGlyphProps) {
  const { spinePath, pillow } = computeBedSpine(
    scaleVisualDeg(headDeg, 45, MAX_VISUAL_DEG),
    scaleVisualDeg(feetDeg, 30, MAX_VISUAL_DEG),
    { headPivotX: HEAD_PIVOT_X, feetPivotX: FEET_PIVOT_X, baselineY: BASELINE_Y, segmentLen: SEGMENT_LEN },
  );
  const color = active ? '#ffffff' : 'rgba(255,255,255,0.5)';

  return (
    <svg viewBox={ `0 0 ${VIEW_W} 40` } width={ 24 } height={ 24 } role="img" aria-label={ label }>
      <path
        d={ spinePath }
        fill="none"
        stroke={ color }
        strokeWidth={ 9 }
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx={ pillow.x } cy={ pillow.y - 8 } rx={ 9 } ry={ 4.5 } fill={ color } />
    </svg>
  );
}
