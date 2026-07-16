import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DeepPartial } from 'ts-essentials';

import { Settings } from '@api/settingsSchema.ts';
import { useAppStore } from '@state/appStore.tsx';

type TemperatureFormatSelectorProps = {
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void;
}

export default function TemperatureFormatSelector({ settings, updateSettings }: TemperatureFormatSelectorProps) {
  const { isUpdating } = useAppStore();
  const format = settings?.temperatureFormat ?? 'fahrenheit';

  return (
    <>
      <Typography variant="body2">Temperature display</Typography>
      <ToggleButtonGroup
        color="primary"
        exclusive
        size="small"
        value={ format }
        disabled={ isUpdating }
        onChange={ (_event, next) => {
          if (next) updateSettings({ temperatureFormat: next });
        } }
      >
        <ToggleButton value="fahrenheit">Fahrenheit</ToggleButton>
        <ToggleButton value="celsius">Celsius</ToggleButton>
        { settings?.features.levelTemps && <ToggleButton value="level">Level (-10 to +10)</ToggleButton> }
      </ToggleButtonGroup>
    </>
  );
}
