import { useId, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { useAppStore } from '@state/appStore';
import { useControlTempStore } from './controlTempStore.tsx';
import TemperatureLabel from './TemperatureLabel.tsx';
import TemperatureButtons from './TemperatureButtons.tsx';
import { controlsSlotSx } from './controlsSlot.ts';
import { fahrenheitToLevel, MAX_TEMP_F, MIN_TEMP_F, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { temperatureColor } from '@lib/temperatureColor';
import { palette } from '@design/tokens';

type SliderProps = {
  isOn: boolean;
  statusUnavailable?: boolean;
  currentTargetTemp: number;
  currentTemperatureF: number;
  refetch: () => unknown;
  format: TemperatureFormat;
  // Shown where the stepper sits while the side is off.
  whenOff?: ReactNode;
};

const dialSx = {
  position: 'relative', width: '100%', maxWidth: 'min(280px, 38dvh, calc(100% - 32px))', mx: 'auto', aspectRatio: '1 / 1', maxHeight: 320,
} as const;

function position(temperature: number) {
  const fraction = Math.max(0, Math.min(1, (temperature - MIN_TEMP_F) / (MAX_TEMP_F - MIN_TEMP_F)));
  const angle = (150 + fraction * 240) * Math.PI / 180;
  return { x: 140 + 122 * Math.cos(angle), y: 140 + 122 * Math.sin(angle) };
}

export default function Slider({ isOn, currentTargetTemp, refetch, currentTemperatureF, format, statusUnavailable, whenOff }: SliderProps) {
  const { side } = useAppStore();
  const target = useControlTempStore(state => state.deviceStatus?.[side]?.targetTemperatureF) ?? currentTargetTemp;
  const color = temperatureColor(fahrenheitToLevel(target));
  const currentColor = temperatureColor(fahrenheitToLevel(currentTemperatureF));
  const gradient = useId();
  const start = position(MIN_TEMP_F);
  const end = position(MAX_TEMP_F);
  const current = position(currentTemperatureF);
  const requested = position(target);
  const clampedCurrent = Math.max(MIN_TEMP_F, Math.min(MAX_TEMP_F, currentTemperatureF));
  const clampedTarget = Math.max(MIN_TEMP_F, Math.min(MAX_TEMP_F, target));
  const span = Math.abs(clampedTarget - clampedCurrent) / (MAX_TEMP_F - MIN_TEMP_F) * 240;
  const activeArc = `M ${current.x} ${current.y} A 122 122 0 ${span > 180 ? 1 : 0} `
    + `${target >= currentTemperatureF ? 1 : 0} ${requested.x} ${requested.y}`;
  // While off, the slot has the stepper's height and overlap, so Turn on sits where Turn off does.
  return <Box sx={ { width: '100%' } }>
    <Box sx={ dialSx }>
      <svg viewBox="0 0 280 280" width="100%" height="100%" aria-hidden="true" style={ { display: 'block', pointerEvents: 'none' } }>
        <defs><linearGradient
          id={ gradient }
          gradientUnits="userSpaceOnUse"
          x1={ current.x }
          y1={ current.y }
          x2={ requested.x }
          y2={ requested.y }>
          <stop stopColor={ currentColor }/><stop offset="1" stopColor={ color }/>
        </linearGradient></defs>
        <path
          d={ `M ${start.x} ${start.y} A 122 122 0 1 1 ${end.x} ${end.y}` }
          stroke={ palette.border.control }
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"/>
        { isOn && <>
          <path
            d={ activeArc }
            stroke={ `url(#${gradient})` }
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"/>
          <circle cx={ requested.x } cy={ requested.y } r="5" fill={ color }/>
        </> }
      </svg>
      <TemperatureLabel
        isOn={ isOn }
        sliderTemp={ target }
        sliderColor={ color }
        currentTargetTemp={ currentTargetTemp }
        currentTemperatureF={ currentTemperatureF }
        format={ format }/>
    </Box>
    { isOn ? <TemperatureButtons
      key={ side }
      statusUnavailable={ statusUnavailable }
      refetch={ refetch }
      currentTargetTemp={ currentTargetTemp }/>
      : <Box sx={ { ...controlsSlotSx, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } }>
        { whenOff }
      </Box> }
  </Box>;
}
