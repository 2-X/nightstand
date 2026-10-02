import { Box, Typography } from '@mui/material';
import { displayTemperature, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { typography } from '@design/tokens';
import { CONTROLS_OVERLAP_PX } from './controlsSlot';

type TemperatureLabelProps = {
  isOn: boolean;
  sliderTemp: number;
  sliderColor: string;
  currentTargetTemp: number;
  currentTemperatureF: number;
  format: TemperatureFormat;
};

export default function TemperatureLabel({
  isOn, sliderTemp, sliderColor, currentTargetTemp, currentTemperatureF, format,
}: TemperatureLabelProps) {
  const pending = sliderTemp !== currentTargetTemp;
  const topTitle = pending ? 'Set to' : currentTemperatureF < currentTargetTemp ? 'Warming to'
    : currentTemperatureF > currentTargetTemp ? 'Cooling to' : 'Holding at';
  return <Box
    sx={ {
      // The reading centres in the ring, above the controls row tucked under it.
      position: 'absolute', top: '18%', left: '5%', right: '5%', bottom: `${CONTROLS_OVERLAP_PX}px`,
      textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, pointerEvents: 'none',
    } }>
    <Box sx={ { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5 } }>
      { isOn ? <>
        <Typography variant="body2" color="text.secondary">{ topTitle }</Typography>
        <Typography
          component="h2"
          sx={ {
            ...typography.hero, color: sliderColor, whiteSpace: 'nowrap',
            fontSize: format === 'level' ? typography.hero.fontSize : 'clamp(2.5rem, 13vw, 3.5rem)',
          } }>{ displayTemperature(sliderTemp, format) }</Typography>
        <Typography variant="body2" color="text.secondary">Currently at { displayTemperature(currentTemperatureF, format) }</Typography>
      </> : <Typography sx={ typography.hero } color="text.secondary">Off</Typography> }
    </Box>
  </Box>;
}
