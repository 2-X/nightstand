import { useId } from 'react';
import { palette } from '@design/tokens';
import { temperatureColor } from '@lib/temperatureColor';
import {
  BAND_WIDTH, DIAL_VIEWBOX, HAND, NOTCH, RUNWAY_LEVEL, bandSegments, clampLevel, dialPoint, fillRange, offArc, radialLine, ticks,
} from './dialGeometry';

type DialRingProps = { isOn: boolean; targetLevel: number; currentLevel: number };

const tickColor = (level: number, major: boolean, isOn: boolean) => isOn
  ? level === 0 ? palette.dial.tickZero : major ? palette.dial.tickMajor : palette.dial.tick
  : major ? palette.dial.tickMajorOff : palette.dial.tickOff;

const band = (from: number, to: number) => bandSegments(from, to).map(segment => <path
  key={ segment.d }
  d={ segment.d }
  stroke={ temperatureColor(segment.level) }
  strokeWidth={ BAND_WIDTH }
  fill="none"/>);

// The scale spans 200 degrees of a 240 degree band; the spare ends run under the steppers.
export default function DialRing({ isOn, targetLevel, currentLevel }: DialRingProps) {
  const blur = useId();
  const target = clampLevel(targetLevel);
  const fill = fillRange(target);
  const glow = dialPoint(target);
  const hand = radialLine(target, HAND.inner, HAND.outer);
  const notch = radialLine(clampLevel(currentLevel), NOTCH.inner, NOTCH.outer);
  return (
    <svg
      viewBox={ `0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}` }
      aria-hidden="true"
      style={ {
        position: 'absolute', left: 0, top: 0, width: '100%', height: 'auto', aspectRatio: '1', display: 'block',
        overflow: 'visible', pointerEvents: 'none',
      } }>
      <defs>
        <filter id={ blur } x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="11"/></filter>
      </defs>
      { isOn ? <>
        <g data-band="ghost" opacity={ palette.dial.ghostOpacity }>{ band(-RUNWAY_LEVEL, RUNWAY_LEVEL) }</g>
        { fill && <g data-band="fill">{ band(fill[0], fill[1]) }</g> }
      </> : <path
        data-band="off"
        d={ offArc() }
        stroke={ palette.dial.track }
        strokeWidth={ BAND_WIDTH }
        strokeLinecap="round"
        fill="none"/> }
      { ticks().map(({ level, major, ...line }) => <line
        key={ level }
        data-tick={ major ? 'major' : 'minor' }
        { ...line }
        stroke={ tickColor(level, major, isOn) }
        strokeWidth={ major ? 1.6 : 1.4 }
        strokeLinecap="round"/>) }
      { isOn && <>
        <line data-notch { ...notch } stroke={ palette.lamp } strokeWidth="2.6" strokeLinecap="round" opacity="0.85"/>
        <circle data-glow cx={ glow.x } cy={ glow.y } r="24" fill={ temperatureColor(target) } opacity="0.55" filter={ `url(#${blur})` }/>
        <line { ...hand } stroke={ palette.bg.base } strokeWidth="11" strokeLinecap="round"/>
        <line data-hand { ...hand } stroke={ palette.lamp } strokeWidth="5" strokeLinecap="round"/>
      </> }
    </svg>
  );
}
