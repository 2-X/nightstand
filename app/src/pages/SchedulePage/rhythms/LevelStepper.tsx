import { Box, IconButton } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Remove from '@mui/icons-material/Remove';
import {
  formatTemperature, levelToFahrenheit, MAX_TEMP_LEVEL, MIN_TEMP_LEVEL, type TemperatureFormat,
} from '@lib/temperatureConversions';
import { temperatureColor } from '@lib/temperatureColor';
import { palette } from '@design/tokens';

const buttonSx = { width: 44, height: 44, color: 'inherit', border: '1px solid', borderColor: palette.border.control };

export default function LevelStepper({ level, format, label, disabled, onChange }: {
  level: number; format: TemperatureFormat; label: string; disabled: boolean; onChange: (level: number) => void;
}) {
  const text = formatTemperature(levelToFahrenheit(level), format);
  const step = (direction: 1 | -1) => {
    const next = Math.max(MIN_TEMP_LEVEL, Math.min(MAX_TEMP_LEVEL, level + direction));
    if (!disabled && next !== level) onChange(next);
  };
  return <Box sx={ { display: 'flex', alignItems: 'center', gap: 0.5, color: temperatureColor(level) } }>
    <IconButton
      aria-label={ `Decrease ${label.toLowerCase()}` }
      disabled={ disabled || level <= MIN_TEMP_LEVEL }
      sx={ buttonSx }
      onClick={ () => step(-1) }><Remove/></IconButton>
    <Box
      role="spinbutton"
      tabIndex={ disabled ? -1 : 0 }
      aria-label={ label }
      aria-disabled={ disabled }
      aria-valuemin={ MIN_TEMP_LEVEL }
      aria-valuemax={ MAX_TEMP_LEVEL }
      aria-valuenow={ level }
      aria-valuetext={ text }
      onKeyDown={ event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        step(event.key === 'ArrowUp' ? 1 : -1);
      } }
      sx={ { minWidth: 62, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: disabled ? 0.5 : 1,
        '&:focus-visible': { outline: '2px solid', outlineOffset: 3, borderRadius: 1 } } }>{ text }</Box>
    <IconButton
      aria-label={ `Increase ${label.toLowerCase()}` }
      disabled={ disabled || level >= MAX_TEMP_LEVEL }
      sx={ buttonSx }
      onClick={ () => step(1) }><Add/></IconButton>
  </Box>;
}
