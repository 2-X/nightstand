import Grid from '@mui/material/Grid2';
import Switch from '@mui/material/Switch';
import {Box} from '@mui/material';
import Typography from '@mui/material/Typography';
import { DeepPartial } from 'ts-essentials';
import { Settings } from '@api/settingsSchema.ts';
import { Side, useAppStore } from '@state/appStore.tsx';


type AwayModeSwitchProps = {
  side: Side;
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void;
}

export default function AwayModeSwitch({ side, settings, updateSettings }: AwayModeSwitchProps) {
  const { isUpdating } = useAppStore();
  const title = side.charAt(0).toUpperCase() + side.slice(1)

  return (
    <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography variant="h5">{title} Side</Typography>
      <Grid container spacing={0} sx={{ mb: 2 }}>
        <Typography alignContent="center" >Away mode</Typography>
        <Switch
          disabled={isUpdating}
          checked={settings?.[side].awayMode || false}
          onChange={(event) => updateSettings({ [side]: { awayMode: event.target.checked } })}
        />
      </Grid>
    </Box>
  );
}
