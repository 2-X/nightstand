import { Box, Typography } from '@mui/material';
import { displayTemperature, TemperatureFormat } from '@lib/temperatureConversions.ts';
import { typography } from '@design/tokens';
import { CONTROLS_OVERLAP_PX } from './controlsSlot';
import { useBedCaption } from './useBedCaption';

// The ring is open at the bottom: a caption wider than this runs into the arc ends.
const captionSx = { maxWidth: '70%', textWrap: 'balance', lineHeight: 1.4 } as const;
// Two caption lines; the slot is always this tall so the caption never moves with the value above it.
const captionSlotHeight = `calc(2 * ${captionSx.lineHeight} * ${typography.caption.fontSize})`;

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
  const lines = useBedCaption(isOn);
  const pending = sliderTemp !== currentTargetTemp;
  const topTitle = pending ? 'Set to' : currentTemperatureF < currentTargetTemp ? 'Warming to'
    : currentTemperatureF > currentTargetTemp ? 'Cooling to' : 'Holding at';
  return <Box
    sx={ {
      // The caption ends a comfortable gap above the controls row tucked under the ring.
      position: 'absolute', top: '18%', left: '5%', right: '5%', bottom: theme => `calc(${CONTROLS_OVERLAP_PX}px + ${theme.spacing(2)})`,
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
    <Box sx={ { height: captionSlotHeight, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 } }>
      { lines.map(line => <Typography key={ line } variant="caption" color="text.secondary" sx={ captionSx }>
        { line }
      </Typography>) }
    </Box>
  </Box>;
}
