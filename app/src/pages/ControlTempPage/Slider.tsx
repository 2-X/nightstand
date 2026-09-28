import { useId } from 'react';
import { Box } from '@mui/material';
import { useAppStore } from '@state/appStore';
import { useControlTempStore } from './controlTempStore.tsx';
import TemperatureLabel from './TemperatureLabel.tsx';
import TemperatureButtons from './TemperatureButtons.tsx';
import { fahrenheitToLevel, MAX_TEMP_F, MIN_TEMP_F, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { temperatureColor } from '@lib/temperatureColor';
import { palette } from '@design/tokens';

type SliderProps = {
  isOn: boolean;
  currentTargetTemp: number;
  currentTemperatureF: number;
  refetch: () => unknown;
  format: TemperatureFormat;
};

function position(temperature: number) {
  const fraction = Math.max(0, Math.min(1, (temperature - MIN_TEMP_F) / (MAX_TEMP_F - MIN_TEMP_F)));
  const angle = (150 + fraction * 240) * Math.PI / 180;
  return { x: 140 + 122 * Math.cos(angle), y: 140 + 122 * Math.sin(angle) };
}

export default function Slider({ isOn, currentTargetTemp, refetch, currentTemperatureF, format }: SliderProps) {
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
  return <Box sx={ { width: '100%', maxWidth: { xs: 280, sm: 320 } } }>
    <Box sx={ { position: 'relative', width: '100%', aspectRatio: '1 / 1', maxHeight: 320 } }>
      <svg viewBox="0 0 280 280" width="100%" height="100%" aria-hidden="true" style={ { pointerEvents: 'none' } }>
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
    { isOn && <TemperatureButtons key={ side } refetch={ refetch } currentTargetTemp={ currentTargetTemp }/> }
  </Box>;
}
