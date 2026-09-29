import { Box, TextField } from '@mui/material';
import { Settings } from '@api/settingsSchema.ts';
import { DeepPartial } from 'ts-essentials';
import { useAppStore } from '@state/appStore.tsx';
import FeatureToggleRow from './FeaturesSection/FeatureToggleRow';

type PrimePodScheduleProps = {
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void;
};

export default function DailyPriming({ settings, updateSettings }: PrimePodScheduleProps) {
  const { isUpdating } = useAppStore();
  return <Box sx={ { display: 'flex', flexDirection: 'column', gap: 2, mb: 2 } }>
    <FeatureToggleRow
      label="Prime daily"
      disabled={ isUpdating }
      checked={ settings?.primePodDaily?.enabled ?? false }
      onChange={ next => updateSettings({ primePodDaily: { enabled: next } }) }
    />
    <TextField
      label="Prime time"
      type="time"
      value={ settings?.primePodDaily?.time || '12:00' }
      onChange={ event => updateSettings({ primePodDaily: { time: event.target.value } }) }
      disabled={ isUpdating || settings?.primePodDaily?.enabled === false }
      fullWidth
    />
    <FeatureToggleRow
      label="Restart the Pod an hour before priming"
      disabled={ isUpdating || settings?.primePodDaily?.enabled === false }
      checked={ settings?.rebootDaily ?? true }
      onChange={ next => updateSettings({ rebootDaily: next }) }
    />
  </Box>;
}
