import { useEffect, useState } from 'react';
import { Box, Radio, RadioGroup, Typography } from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useServices } from '@api/services.ts';
import { usePresence, PresenceSide } from '@api/presence.ts';
import { fahrenheitToLevel, formatTemperature } from '@lib/temperatureConversions.ts';
import { temperatureColor } from '@lib/temperatureColor';
import { palette } from '@design/tokens';

function presenceLabel(observation: PresenceSide | undefined): string | undefined {
  const age = Date.now() - Date.parse(observation?.lastUpdatedAt ?? '');
  const elapsed = Date.now() - Date.parse(observation?.stateChangedAt ?? '');
  if (!observation?.present || !Number.isFinite(age) || age < 0 || age > 5 * 60_000 || !Number.isFinite(elapsed) || elapsed < 0) return;
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 1 ? 'In bed less than a minute' : `In bed ${minutes} min`;
}

export default function SideControl({ compact = true, mergeAwaySides = true, beforeSideChange, captions }: {
  captions?: Partial<Record<'left' | 'right', string>>;
  compact?: boolean;
  mergeAwaySides?: boolean;
  beforeSideChange?: (side: 'left' | 'right') => boolean;
}) {
  const { side, setSide } = useAppStore();
  const { data: settings } = useSettings();
  const { data: deviceStatus } = useDeviceStatus();
  const { data: services } = useServices();
  const { data: presence } = usePresence();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const format = settings?.temperatureFormat ?? 'fahrenheit';
  const other = side === 'left' ? 'right' : 'left';
  const both = mergeAwaySides && settings?.[other]?.awayMode && !settings?.[side]?.awayMode;
  const keys = both ? [side] : ['left', 'right'] as const;
  return (
    <RadioGroup
      aria-label="Bed side"
      row
      value={ side }
      onChange={ (_event, value) => {
        if ((value === 'left' || value === 'right') && value !== side && (!beforeSideChange || beforeSideChange(value))) setSide(value);
      } }
      sx={ {
        width: '100%', display: 'grid', gridTemplateColumns: both ? '1fr' : '1fr 1fr', gap: 1,

      } }>
      { keys.map(key => {
        const selected = side === key;
        const status = deviceStatus?.[key];
        const name = settings?.[key]?.name || (key === 'left' ? 'Left side' : 'Right side');
        const away = settings?.[key]?.awayMode;
        const temperature = status ? formatTemperature(status.targetTemperatureF, format) : '';
        const direction = status && (status.currentTemperatureF > status.targetTemperatureF ? 'cooling'
          : status.currentTemperatureF < status.targetTemperatureF ? 'warming' : 'holding');
        const state = captions?.[key] ?? (away ? 'Away' : !status ? 'Status unavailable' : !status.isOn ? 'Off'
          : `${temperature}, ${direction}`);
        const calibration = services?.biometrics?.jobs?.[key === 'left' ? 'calibrateLeft' : 'calibrateRight'];
        const occupancy = !captions && !compact && !away && services?.biometrics?.enabled && calibration?.status === 'healthy'
          ? presenceLabel(presence?.[key]) : undefined;
        const title = both ? 'Both sides' : name;
        return <Box
          component="label"
          key={ key }
          sx={ {
            position: 'relative', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0,
            minHeight: compact ? 48 : 88, py: compact ? 0.5 : 1, px: compact ? 1 : 1.5, cursor: 'pointer', borderRadius: '24px',
            bgcolor: selected ? palette.bg.selected : palette.bg.elevated,
            border: `2px solid ${selected ? palette.lamp : palette.border.subtle}`,
            '&:has(input:focus-visible)': { outline: `2px solid ${palette.lamp}`, outlineOffset: 3 },
          } }>
          <Radio
            value={ key }
            checked={ selected }
            slotProps={ { input: {
              'aria-label': `${title}. ${both ? `${name}'s controls apply to both sides. ` : ''}${state}.${occupancy ? ` ${occupancy}.` : ''}`,
            } } }
            sx={ { position: 'absolute', inset: 0, opacity: 0, p: 0, '& input': { width: '100%', height: '100%' } } }/>
          <Box sx={ { minWidth: 0, flex: 1 } }>
            <Typography fontWeight={ 600 } sx={ { fontSize: 16, pr: 2.5, overflowWrap: 'anywhere', lineHeight: compact ? 1.2 : 1.5 } }>
              <bdi>{ title }</bdi>
            </Typography>
            <Box sx={ { display: 'flex', alignItems: 'center', gap: 0.5 } }>
              <Typography
                variant="caption"
                color={ !captions?.[key] && status?.isOn && !away
                  ? temperatureColor(fahrenheitToLevel(status.targetTemperatureF)) : 'text.secondary' }
                sx={ { lineHeight: compact ? 1.2 : 1.5 } }>
                { captions?.[key] ?? (compact && status?.isOn && !away ? temperature : state) }
              </Typography>
            </Box>
            { occupancy && <Typography variant="caption" color="text.secondary">{ occupancy }</Typography> }
          </Box>
          { selected && <CheckCircleOutline
            aria-hidden
            sx={ { position: 'absolute', top: 10, right: 10, fontSize: 18, color: palette.lamp, pointerEvents: 'none' } }/> }
        </Box>;
      }) }
    </RadioGroup>
  );
}
