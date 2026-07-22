import { ReactNode } from 'react';
import InfoIcon from '@mui/icons-material/Info';
import { Box, Typography, Switch } from '@mui/material';
import { palette } from '@design/tokens';

type FeatureToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
};

// Presentation only, no opinion on what backs the toggle: the settings
// features object, the services store (biometrics), or anything else a
// future flag needs. Every Settings toggle row was hand-rolled inline
// before this; this is the first shared one.
export default function FeatureToggleRow({ label, checked, onChange, disabled, description }: FeatureToggleRowProps) {
  return (
    <Box sx={ { mb: 1 } }>
      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 } }>
        <Typography sx={ { fontSize: '1rem', color: palette.text.primary } }>{ label }</Typography>
        <Switch
          disabled={ disabled }
          checked={ checked }
          onChange={ (event) => onChange(event.target.checked) }
          slotProps={ { input: { 'aria-label': label } } }
        />
      </Box>
      { description && (
        <Box display='flex' gap={ 1 } alignItems='flex-start' sx={ { mt: 1 } }>
          <InfoIcon sx={ { color: palette.text.tertiary, fontSize: 18, mt: '2px' } }/>
          <Typography sx={ { color: palette.text.tertiary, fontSize: '0.85rem', lineHeight: 1.5 } }>
            { description }
          </Typography>
        </Box>
      ) }
    </Box>
  );
}
