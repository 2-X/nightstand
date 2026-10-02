import { Link } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { media, palette } from '@design/tokens';
import PowerButton, { type PowerButtonProps } from './PowerButton';
import { powerPillSx } from './powerPill';

type PowerRowProps = {
  isOn: boolean;
  refetch: PowerButtonProps['refetch'];
  // Puts Try again in the button's place while the Pod does not answer.
  onRetry?: () => void;
  // Empty at its full height while the status loads.
  loading?: boolean;
};

// One height whatever it holds, so nothing under it moves.
const rowSx = {
  width: '100%', minHeight: 54, mt: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  [media.short]: { mt: '6px' },
  [media.tight]: { mt: '2px', minHeight: 48 },
} as const;

export default function PowerRow({ isOn, refetch, onRetry, loading = false }: PowerRowProps) {
  const { side, isUpdating } = useAppStore();
  const { data: settings } = useSettings();
  const away = !!settings?.[side]?.awayMode;
  return <Box data-power-row sx={ rowSx }>
    { loading ? null : onRetry ? <Button
      aria-disabled={ isUpdating || undefined }
      onClick={ () => { if (!isUpdating) onRetry(); } }
      sx={ powerPillSx('on') }>
      Try again
    </Button>
      : away ? <Typography sx={ { fontSize: 15, color: 'text.secondary', textAlign: 'center' } }>
        Away mode is on. Change it in <Link
          to="/settings/bed"
          style={ { color: palette.text.primary, textDecoration: 'underline', textUnderlineOffset: 2 } }>Settings, Bed and sides</Link>.
      </Typography>
        : <PowerButton isOn={ isOn } refetch={ refetch }/> }
  </Box>;
}
