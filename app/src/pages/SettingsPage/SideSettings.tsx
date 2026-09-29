import FeatureToggleRow from './FeaturesSection/FeatureToggleRow';
import { Box, TextField, Typography } from '@mui/material';
import { DeepPartial } from 'ts-essentials';
import { useEffect, useState } from 'react';

import { Settings } from '@api/settingsSchema.ts';
import { Side, useAppStore } from '@state/appStore.tsx';

type AwayModeSwitchProps = {
  side: Side;
  settings?: Settings;
  updateSettings: (settings: DeepPartial<Settings>) => void | Promise<void>;
}

export default function SideSettings({ side, settings, updateSettings }: AwayModeSwitchProps) {
  const { isUpdating } = useAppStore();
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState(false);
  const savedName = settings?.[side]?.name;
  const title = side.charAt(0).toUpperCase() + side.slice(1);

  // Local state to manage the text field value
  const [sideName, setSideName] = useState(settings?.[side]?.name || '');
  // Update local state when settings change (e.g., from API)
  useEffect(() => {
    setSideName(savedName ?? side);
  }, [savedName, side]);

  const handleBlur = async () => {
    const name = sideName.trim();
    setNameError(!name);
    if (!name || name === savedName) return;
    setSavingName(true);
    try {
      await updateSettings({ [side]: { name } });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <Box sx={ { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2 } }>
      <Typography variant="body2" color="text.secondary" fontWeight={ 600 }>{ title } side</Typography>
      <TextField
        label="Side name"
        placeholder="Enter side name"
        value={ sideName }
        onChange={ (e) => { setSideName(e.target.value); setNameError(false); } }
        onBlur={ () => void handleBlur() }
        disabled={ savingName || !settings }
        error={ nameError }
        helperText={ nameError ? 'Enter a side name.' : undefined }
        inputProps={ { maxLength: 20, style: { unicodeBidi: 'isolate' } } }
        fullWidth
      />
      <FeatureToggleRow
        label="Away mode"
        ariaLabel={ `${title} away mode` }
        disabled={ isUpdating }
        checked={ settings?.[side]?.awayMode || false }
        onChange={ next => updateSettings({ [side]: { awayMode: next } }) }
      />
    </Box>
  );
}
