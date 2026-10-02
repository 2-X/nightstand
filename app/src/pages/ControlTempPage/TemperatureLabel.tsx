import { Box, Typography } from '@mui/material';
import { media } from '@design/tokens';
import { displayTemperature, type TemperatureFormat } from '@lib/temperatureConversions.ts';

type TemperatureLabelProps = {
  isOn: boolean;
  sliderTemp: number;
  sliderColor: string;
  currentTargetTemp: number;
  currentTemperatureF: number;
  format: TemperatureFormat;
};

// Over the ring's square, nudged up so the numeral sits in the ring's optical centre.
export const centreSx = {
  position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: '1', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', pb: '7%', textAlign: 'center', pointerEvents: 'none',
} as const;
// The dial shrinks on short screens; under 260 px its type steps down so the words clear the ring and its dot.
const smallDial = '@container (max-width: 259.95px)';
const tinyDial = '@container (max-width: 219.95px)';
const lineSx = { fontSize: 15, lineHeight: 1.3, color: 'text.secondary', [smallDial]: { fontSize: 14 }, [tinyDial]: { fontSize: 13 } } as const;
const signSx = { fontSize: '0.5em', fontWeight: 300, verticalAlign: '0.55em', mr: '0.02em', letterSpacing: 0 } as const;
const offSx = {
  color: 'text.secondary', fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 0.95,
  fontSize: 84, [media.narrow]: { fontSize: 76 }, [smallDial]: { fontSize: 64 }, [tinyDial]: { fontSize: 52 },
} as const;
// °F and °C run to four or five characters, so they get a smaller numeral than a level.
const numeralSize = (format: TemperatureFormat) => format === 'level'
  ? {
    fontSize: 100, [media.narrow]: { fontSize: 88 }, [media.desktop]: { fontSize: 104 },
    [smallDial]: { fontSize: 70, m: '2px 0 4px' }, [tinyDial]: { fontSize: 56, m: '2px 0 4px' },
  }
  : {
    fontSize: 64, letterSpacing: '-0.03em', [media.narrow]: { fontSize: 56 }, [media.desktop]: { fontSize: 72 },
    [smallDial]: { fontSize: 46, m: '2px 0 4px' }, [tinyDial]: { fontSize: 38, m: '2px 0 4px' },
  };

export default function TemperatureLabel({
  isOn, sliderTemp, sliderColor, currentTargetTemp, currentTemperatureF, format,
}: TemperatureLabelProps) {
  const pending = sliderTemp !== currentTargetTemp;
  const topTitle = pending ? 'Set to' : currentTemperatureF < currentTargetTemp ? 'Warming to'
    : currentTemperatureF > currentTargetTemp ? 'Cooling to' : 'Holding at';
  const value = displayTemperature(sliderTemp, format);
  const sign = /^[+\u2212]/.test(value) ? value[0] : '';
  return <Box sx={ centreSx }>
    { isOn ? <>
      <Typography sx={ lineSx }>{ topTitle }</Typography>
      <Typography
        component="h2"
        sx={ {
          fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 0.95, m: '4px 0 6px', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums', color: sliderColor, ...numeralSize(format),
        } }>
        { sign && <Box component="span" sx={ signSx }>{ sign }</Box> }
        { value.slice(sign.length) }
      </Typography>
      <Typography sx={ lineSx }>Currently at { displayTemperature(currentTemperatureF, format) }</Typography>
    </> : <Typography sx={ offSx }>Off</Typography> }
  </Box>;
}
