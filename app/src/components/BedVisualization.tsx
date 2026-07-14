import { Box } from '@mui/material';
import { useId, useMemo } from 'react';
import { computeBedSpine, quiltMarks, scaleVisualDeg } from '@lib/bedGeometry.ts';
import { useTweenedNumber } from './useTweenedNumber';

interface BedVisualizationProps {
  headPosition: number; // 0-45 degrees, matches the base's real head-tilt range
  feetPosition: number; // 0-30 degrees, matches the base's real feet-tilt range
}

// A schematic side profile: two hinged panels (head, feet) either side of a
// fixed centre platform, matching how adjustable bases are actually built.
// Original geometry and shading, drawn in the same visual language as
// PresetGlyph - no photographic/rendered assets.
const VIEW_W = 400;
const BASELINE_Y = 96;
const HEAD_PIVOT_X = 182;
const FEET_PIVOT_X = 218;
const SEGMENT_LEN = 154;
const MATTRESS_THICKNESS = 34;
// The base's real range (0-45 / 0-30) barely reads as motion over a 154px
// segment, so the visual tilt is exaggerated relative to the physical degrees.
const MAX_VISUAL_DEG = 34;

export default function BedVisualization({
  headPosition,
  feetPosition,
}: BedVisualizationProps) {
  const uid = useId();
  const headTarget = scaleVisualDeg(headPosition, 45, MAX_VISUAL_DEG);
  const feetTarget = scaleVisualDeg(feetPosition, 30, MAX_VISUAL_DEG);
  const headDeg = useTweenedNumber(headTarget);
  const feetDeg = useTweenedNumber(feetTarget);

  const { spinePath, pillow, headPivot, headTip, feetPivot, feetTip } = useMemo(
    () => computeBedSpine(headDeg, feetDeg, {
      headPivotX: HEAD_PIVOT_X,
      feetPivotX: FEET_PIVOT_X,
      baselineY: BASELINE_Y,
      segmentLen: SEGMENT_LEN,
    }),
    [headDeg, feetDeg],
  );

  const quilting = useMemo(
    () => [
      ...quiltMarks(headPivot, headTip, 2, MATTRESS_THICKNESS * 0.34),
      ...quiltMarks(feetPivot, feetTip, 2, MATTRESS_THICKNESS * 0.34),
    ],
    [headPivot, headTip, feetPivot, feetTip],
  );

  const mattressGradId = `mattress-${uid}`;
  const pillowGradId = `pillow-${uid}`;
  const pillowCx = pillow.x;
  const pillowCy = pillow.y - MATTRESS_THICKNESS / 2 - 9;

  return (
    <Box sx={ { width: '100%', maxWidth: 400, mx: 'auto' } }>
      <svg
        viewBox={ `-14 -34 ${VIEW_W + 28} 176` }
        width="100%"
        height="160"
        role="img"
        aria-label={ `Base tilted ${headPosition}° at the head, ${feetPosition}° at the feet` }
      >
        <defs>
          <linearGradient
            id={ mattressGradId }
            x1="0"
            y1={ BASELINE_Y - MATTRESS_THICKNESS / 2 }
            x2="0"
            y2={ BASELINE_Y + MATTRESS_THICKNESS / 2 }
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#565658" />
            <stop offset="0.45" stopColor="#3a3a3c" />
            <stop offset="1" stopColor="#222224" />
          </linearGradient>
          <linearGradient id={ pillowGradId } x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5f6f8" />
            <stop offset="1" stopColor="#cacdd3" />
          </linearGradient>
        </defs>

        { /* ground shadow */ }
        <ellipse
          cx={ VIEW_W / 2 }
          cy={ BASELINE_Y + MATTRESS_THICKNESS / 2 + 22 }
          rx={ 158 }
          ry={ 9 }
          fill="rgba(0,0,0,0.4)"
        />

        { /* fixed base platform the panels hinge from */ }
        <rect
          x={ -6 }
          y={ BASELINE_Y + MATTRESS_THICKNESS / 2 + 6 }
          width={ VIEW_W + 12 }
          height={ 10 }
          rx={ 5 }
          fill="#1c1c1e"
        />

        { /* mattress body */ }
        <path
          d={ spinePath }
          fill="none"
          stroke={ `url(#${mattressGradId})` }
          strokeWidth={ MATTRESS_THICKNESS }
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        { /* channel-quilting texture (generic, evenly-spaced - not a logo mark) */ }
        { quilting.map((m, i) => (
          <line
            key={ i }
            x1={ m.x1 }
            y1={ m.y1 }
            x2={ m.x2 }
            y2={ m.y2 }
            stroke="rgba(0,0,0,0.22)"
            strokeWidth={ 2 }
            strokeLinecap="round"
          />
        )) }

        { /* top-surface highlight */ }
        <path
          d={ spinePath }
          fill="none"
          stroke="#606062"
          strokeWidth={ MATTRESS_THICKNESS - 20 }
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(0, -6)"
          opacity={ 0.55 }
        />

        { /* pillow shadow */ }
        <ellipse cx={ pillowCx } cy={ pillowCy + 5 } rx={ 29 } ry={ 13 } fill="rgba(0,0,0,0.28)" />
        { /* pillow */ }
        <ellipse cx={ pillowCx } cy={ pillowCy } rx={ 29 } ry={ 14 } fill={ `url(#${pillowGradId})` } />
        { /* pillow crease */ }
        <path
          d={ `M ${pillowCx - 14} ${pillowCy} Q ${pillowCx} ${pillowCy + 5} ${pillowCx + 14} ${pillowCy}` }
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={ 1.5 }
          fill="none"
        />
      </svg>
    </Box>
  );
}
