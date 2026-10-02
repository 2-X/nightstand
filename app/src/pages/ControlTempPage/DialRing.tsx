import { palette } from '@design/tokens';
import { temperatureColor } from '@lib/temperatureColor';
import {
  DIAL_HEIGHT, DIAL_WIDTH, NOTCH, SCALE_MAX, SCALE_MIN, TRACK_WIDTH, bandSegments, clampLevel, dialPoint, endLabels, fillRange, offArc,
  radialLine, ticks,
} from './dialGeometry';

type DialRingProps = { isOn: boolean; targetLevel: number; currentLevel: number; pending?: boolean; stale?: boolean; away?: boolean };

const tickColor = (level: number, major: boolean, isOn: boolean) => isOn
  ? level === 0 ? palette.dial.tickZero : major ? palette.dial.tickMajor : palette.dial.tick
  : major ? palette.dial.tickMajorOff : palette.dial.tickOff;

const band = (from: number, to: number) => bandSegments(from, to).map(segment => <path
  key={ segment.d }
  d={ segment.d }
  stroke={ temperatureColor(segment.level) }
  strokeWidth={ TRACK_WIDTH }
  fill="none"/>);

// Closer than this, now and the target are the same place on the ring.
const SAME_LEVEL = 0.01;

const endLabel = (level: number) => level < 0 ? `\u2212${-level}` : `+${level}`;

// The parts of the ring that never move, worked out once.
const GHOST_BAND = band(SCALE_MIN, SCALE_MAX);
const OFF_ARC = offArc();
const TICKS = ticks();
const END_LABELS = endLabels();

const svgStyle = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible', pointerEvents: 'none',
} as const;

// Every mark is a state: the faint scale, the span to the target, the notch for now, the dot for the target.
export default function DialRing({ isOn, targetLevel, currentLevel, pending = false, stale = false, away = false }: DialRingProps) {
  // Colour means live: a last known target, or an away side's, is drawn grey on the off track.
  const live = isOn && !stale && !away;
  const target = clampLevel(targetLevel);
  const current = clampLevel(currentLevel);
  const fill = fillRange(target);
  const dot = dialPoint(target);
  const colour = temperatureColor(target);
  const notch = radialLine(current, NOTCH.inner, NOTCH.outer);
  return (
    <svg viewBox={ `0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}` } aria-hidden="true" style={ svgStyle }>
      { live ? <>
        <g data-band="ghost" opacity={ palette.dial.ghostOpacity }>{ GHOST_BAND }</g>
        { fill && <g data-band="fill">{ band(fill[0], fill[1]) }</g> }
      </> : <path
        data-band="off"
        d={ OFF_ARC }
        stroke={ palette.dial.trackOff }
        strokeWidth={ TRACK_WIDTH }
        strokeLinecap="round"
        fill="none"/> }
      { TICKS.map(({ level, major, ...line }) => <line
        key={ level }
        data-tick={ major ? 'major' : 'minor' }
        { ...line }
        stroke={ tickColor(level, major, live) }
        strokeWidth={ major ? 1.8 : 1.4 }
        strokeLinecap="round"/>) }
      { live && Math.abs(current - target) > SAME_LEVEL && <>
        <line { ...notch } stroke={ palette.bg.base } strokeWidth="5.5" strokeLinecap="round"/>
        <line data-notch { ...notch } stroke={ palette.lamp } strokeWidth="2.2" strokeLinecap="round" opacity="0.9"/>
      </> }
      { live && <>
        <circle
          data-halo
          cx={ dot.x }
          cy={ dot.y }
          r="14"
          fill="none"
          stroke={ colour }
          strokeWidth="1.5"
          opacity={ palette.dial.haloOpacity }/>
        { /* Hollow until the Pod reports the new target, then filled. */ }
        { pending
          ? <circle data-target data-pending cx={ dot.x } cy={ dot.y } r="7.5" fill={ palette.bg.base } stroke={ colour } strokeWidth="2.5"/>
          : <circle data-target cx={ dot.x } cy={ dot.y } r="8.5" fill={ colour } stroke={ palette.bg.base } strokeWidth="2.5"/> }
      </> }
      { isOn && !live && <circle
        data-target
        data-stale={ stale || undefined }
        cx={ dot.x }
        cy={ dot.y }
        r="8.5"
        fill={ palette.text.tertiary }
        stroke={ palette.bg.base }
        strokeWidth="2.5"/> }
      { END_LABELS.map(({ level, x, y }) => <text
        key={ level }
        data-end-label
        x={ x }
        y={ y }
        textAnchor="middle"
        fontSize="11.5"
        fontFamily="inherit"
        fill={ live ? palette.text.tertiary : palette.text.disabled }>{ endLabel(level) }</text>) }
    </svg>
  );
}
