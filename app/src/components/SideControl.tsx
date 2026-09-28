import { useEffect, useState } from 'react';
import { ToggleButtonGroup, ToggleButton, Box, Tooltip } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { usePresence, PresenceSide } from '@api/presence.ts';
import { formatTemperature } from '@lib/temperatureConversions.ts';

function isFresh(side: PresenceSide | undefined): boolean {
  const age = Date.now() - Date.parse(side?.lastUpdatedAt ?? '');
  return Number.isFinite(age) && age >= 0 && age <= 5 * 60_000;
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

function presenceLabel(side: PresenceSide | undefined): string {
  if (!side?.lastUpdatedAt) return 'Presence unavailable';
  if (!isFresh(side)) return 'Presence stale';
  const elapsed = Date.now() - Date.parse(side.stateChangedAt ?? '');
  if (!Number.isFinite(elapsed) || elapsed < 0) return side.present ? 'Presence detected' : 'No presence';
  return side.present ? `In bed for ${formatDuration(elapsed)}` : `No presence for ${formatDuration(elapsed)}`;
}

export default function SideControl({ showTemp, beforeSideChange }: { showTemp?: boolean; beforeSideChange?: () => boolean }) {
  const { side, setSide } = useAppStore();
  const { data: settings } = useSettings();
  const { data: deviceStatus } = useDeviceStatus();
  const { data: presence } = usePresence();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const format = settings?.temperatureFormat ?? 'fahrenheit';
  return (
    <ToggleButtonGroup
      aria-label="Bed side"
      color="primary"
      exclusive
      value={ side }
      onChange={ (_event, value: unknown) => {
        if ((value === 'left' || value === 'right') && value !== side && (!beforeSideChange || beforeSideChange())) setSide(value);
      } }
      size="small"
    >
      { (['left', 'right'] as const).map(key => (
        <Tooltip key={ key } describeChild title={ presenceLabel(presence?.[key]) }>
          <ToggleButton value={ key } sx={ { p: 1, gap: 0.75 } }>
            { settings?.[key]?.name ?? (key === 'left' ? 'Left' : 'Right') }
            { showTemp && side !== key && ' ' }
            { showTemp && side !== key && (
              deviceStatus?.[key]?.isOn
                ? formatTemperature(deviceStatus[key].targetTemperatureF, format)
                : 'Off'
            ) }
            <Box
              component="span"
              aria-hidden
              sx={ {
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                backgroundColor: !isFresh(presence?.[key]) ? 'text.disabled' : presence?.[key]?.present ? 'success.main' : 'text.secondary',
              } }/>
          </ToggleButton>
        </Tooltip>
      )) }
    </ToggleButtonGroup>
  );
}
