import { useEffect, useState } from 'react';
import { Box, Radio, RadioGroup, Typography } from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { useServices } from '@api/services.ts';
import { usePresence, PresenceSide } from '@api/presence.ts';
import { isSchedulePaused } from '@api/schedulePause.ts';
import { displayTemperature, fahrenheitToLevel } from '@lib/temperatureConversions.ts';
import { temperatureColor } from '@lib/temperatureColor';
import { media, palette, radius } from '@design/tokens';

function presenceLabel(observation: PresenceSide | undefined): string | undefined {
  const age = Date.now() - Date.parse(observation?.lastUpdatedAt ?? '');
  const elapsed = Date.now() - Date.parse(observation?.stateChangedAt ?? '');
  if (!observation?.present || !Number.isFinite(age) || age < 0 || age > 5 * 60_000 || !Number.isFinite(elapsed) || elapsed < 0) return;
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 1 ? 'In bed less than a minute' : `In bed ${minutes} min`;
}

const focusRing = { '&:has(input:focus-visible)': { outline: `2px solid ${palette.lamp}`, outlineOffset: 3 } } as const;
// Bed's tiles: warm when selected, content from the top, and room for the presence line so the pair never grows.
// The shorter heights keep the power row above the bottom bar on short screens.
const bedTileSx = (selected: boolean) => ({
  position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', minWidth: 0, minHeight: 84,
  p: '11px 12px 10px 14px', cursor: 'pointer', borderRadius: `${radius.lg}px`,
  bgcolor: selected ? palette.ember : palette.bg.elevated,
  border: `1.5px solid ${selected ? palette.tile.selectedBorder : palette.border.subtle}`,
  ...focusRing,
  // Later queries win: the short heights set only the vertical padding, so a narrow phone keeps its tighter sides.
  [media.narrow]: { pl: '12px', pr: '10px', pt: '10px', pb: '9px' },
  [media.short]: { minHeight: 80, pt: '8px', pb: '7px' },
  [media.tight]: { minHeight: 66, pt: '4px', pb: '3px' },
}) as const;
const compactTileSx = (selected: boolean) => ({
  position: 'relative', display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 48, py: 0.5, px: 1,
  cursor: 'pointer', borderRadius: '24px',
  bgcolor: selected ? palette.bg.selected : palette.bg.elevated,
  border: `2px solid ${selected ? palette.lamp : palette.border.subtle}`,
  ...focusRing,
}) as const;

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
        width: '100%', display: 'grid', gridTemplateColumns: both ? '1fr' : '1fr 1fr', gap: compact ? 1 : '10px',
      } }>
      { keys.map(key => {
        const selected = side === key;
        const status = deviceStatus?.[key];
        const name = settings?.[key]?.name || (key === 'left' ? 'Left side' : 'Right side');
        const away = settings?.[key]?.awayMode;
        // Away mode wins over a pause.
        const paused = !away && !!settings && isSchedulePaused(settings, key, new Date(Date.now()));
        const temperature = status ? displayTemperature(status.targetTemperatureF, format) : '';
        const direction = status && (status.currentTemperatureF > status.targetTemperatureF ? 'cooling'
          : status.currentTemperatureF < status.targetTemperatureF ? 'warming' : 'holding');
        const live = away ? 'Away' : !status ? 'Status unavailable' : !status.isOn ? 'Off' : `${temperature}, ${direction}`;
        const state = captions?.[key] ?? (paused && status ? `Paused · ${status.isOn ? temperature : 'Off'}` : live);
        const calibration = services?.biometrics?.jobs?.[key === 'left' ? 'calibrateLeft' : 'calibrateRight'];
        const occupancy = !captions && !compact && !away && services?.biometrics?.enabled && calibration?.status === 'healthy'
          ? presenceLabel(presence?.[key]) : undefined;
        // Screen readers would read the middle dot aloud.
        const spoken = state.replace(' · ', ', ');
        const title = both ? 'Both sides' : name;
        const shown = captions?.[key] ?? (compact && status?.isOn && !away ? `${paused ? 'Paused · ' : ''}${temperature}` : state);
        const stateColor = !captions?.[key] && status?.isOn && !away
          ? temperatureColor(fahrenheitToLevel(status.targetTemperatureF)) : 'text.secondary';
        const check = selected && <CheckCircleOutline
          aria-hidden
          sx={ compact
            ? { position: 'absolute', top: 10, right: 10, fontSize: 18, color: palette.lamp, pointerEvents: 'none' }
            : { fontSize: 17, color: palette.lamp, flex: 'none' } }/>;
        return <Box component="label" key={ key } sx={ compact ? compactTileSx(selected) : bedTileSx(selected) }>
          <Radio
            value={ key }
            checked={ selected }
            slotProps={ { input: {
              'aria-label': `${title}. ${both ? `${name}'s controls apply to both sides. ` : ''}${spoken}.${occupancy ? ` ${occupancy}.` : ''}`,
            } } }
            sx={ { position: 'absolute', inset: 0, opacity: 0, p: 0, '& input': { width: '100%', height: '100%' } } }/>
          { compact ? <>
            <Box sx={ { minWidth: 0, flex: 1 } }>
              <Typography fontWeight={ 600 } sx={ { fontSize: 16, pr: 2.5, overflowWrap: 'anywhere', lineHeight: 1.2 } }>
                <bdi>{ title }</bdi>
              </Typography>
              <Typography variant="caption" color={ stateColor } sx={ { display: 'block', lineHeight: 1.2 } }>{ shown }</Typography>
            </Box>
            { check }
          </> : <>
            <Box sx={ { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } }>
              <Typography
                fontWeight={ 600 }
                sx={ {
                  fontSize: 17, lineHeight: 1.3, letterSpacing: '-0.005em', overflowWrap: 'anywhere',
                  [media.narrow]: { fontSize: 16 }, [media.tight]: { lineHeight: 1.2 },
                } }>
                <bdi>{ title }</bdi>
              </Typography>
              { check }
            </Box>
            <Typography
              noWrap
              color={ stateColor }
              sx={ { fontSize: 14, lineHeight: 1.4, mt: '1px', [media.tight]: { lineHeight: 1.25, mt: 0 } } }>
              { shown }
            </Typography>
            { occupancy && <Typography
              noWrap
              color="text.secondary"
              sx={ { fontSize: 13, lineHeight: 1.4, [media.tight]: { lineHeight: 1.25 } } }>
              { occupancy }
            </Typography> }
          </> }
        </Box>;
      }) }
    </RadioGroup>
  );
}
