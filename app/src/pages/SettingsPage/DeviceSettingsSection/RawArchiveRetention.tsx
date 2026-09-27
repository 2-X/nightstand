import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DeepPartial } from 'ts-essentials';

import { Settings } from '@api/settingsSchema.ts';
import { useAppStore } from '@state/appStore.tsx';

const OPTIONS: Array<{ days: number; label: string }> = [
  { days: 2, label: '2 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 60, label: '2 months' },
];

type RawArchiveRetentionProps = {
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void;
}

export default function RawArchiveRetention({ settings, updateSettings }: RawArchiveRetentionProps) {
  const { isUpdating } = useAppStore();

  return (
    <>
      <Typography variant="body2">Keep raw sensor recordings</Typography>
      <ToggleButtonGroup
        color="primary"
        exclusive
        size="small"
        value={ settings?.rawArchiveRetentionDays ?? 14 }
        disabled={ isUpdating }
        onChange={ (_event, next) => {
          if (next) updateSettings({ rawArchiveRetentionDays: next });
        } }
      >
        { OPTIONS.map(({ days, label }) => (
          <ToggleButton key={ days } value={ days }>{ label }</ToggleButton>
        )) }
      </ToggleButtonGroup>
      <Typography color='text.secondary'>
        Sleep analysis and calibration read these recordings. They take about 0.4 GB a day,
        and the oldest are removed first if storage runs low.
      </Typography>
    </>
  );
}
