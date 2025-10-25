import { Box, FormControlLabel, TextField } from '@mui/material';

import { Settings } from '@api/settingsSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import Switch from '@mui/material/Switch';


type PrimePodScheduleProps = {
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void;
}

export default function DailyPriming({ settings, updateSettings }: PrimePodScheduleProps) {
  const { isUpdating } = useAppStore();

  return (
    <>
      <Box sx={ { display: 'flex', alignItems: 'center', gap: 2, mb: 1 } }>
        <FormControlLabel
          control={
            <Switch
              disabled={ isUpdating }
              checked={ settings?.primePodDaily?.enabled || false }
              onChange={ (event) => updateSettings({ primePodDaily: { enabled: event.target.checked } }) }
            />
          }
          label="Prime daily?"
        />
        <TextField
          label="Prime time"
          type="time"
          size='medium'
          variant='standard'
          value={ settings?.primePodDaily?.time || '12:00' }
          onChange={ (e) => updateSettings({ primePodDaily: { time: e.target.value } }) }
          disabled={ isUpdating || settings?.primePodDaily?.enabled === false }
        />
      </Box>
    </>

  );
}
