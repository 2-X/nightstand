import { Link } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { media, palette } from '@design/tokens';
import DockCaption, { dockSlotSx } from './DockCaption';
import PowerButton, { type PowerButtonProps } from './PowerButton';
import { powerPillSx } from './powerPill';

type PowerDockProps = {
  isOn: boolean;
  refetch: PowerButtonProps['refetch'];
  // Shown instead of the caption while the bed status loads or cannot be read.
  message?: string;
  // Puts Try again where the power control sits.
  onRetry?: () => void;
};

// The caption and the power control share one row that never moves, whatever the dial shows.
export default function PowerDock({ isOn, refetch, message, onRetry }: PowerDockProps) {
  const { side, isUpdating } = useAppStore();
  const { data: settings } = useSettings();
  const away = !!settings?.[side]?.awayMode;
  return (
    <Box
      data-power-dock
      sx={ {
        width: '100%', display: 'flex', alignItems: 'center', gap: '12px', mt: '10px', minHeight: 72, containerType: 'inline-size',
        p: '8px 8px 8px 18px', borderRadius: '28px', bgcolor: palette.dock.bg, border: `1px solid ${palette.dock.border}`,
        [media.narrow]: { gap: '8px', pl: '14px' },
      } }>
      { message ? <Typography role="status" sx={ dockSlotSx }>{ message }</Typography>
        : away ? <Typography sx={ dockSlotSx }>
          Away mode is on. Change it in <Link
            to="/settings/bed"
            style={ { color: palette.text.primary, textDecoration: 'underline', textUnderlineOffset: 2 } }>Settings, Bed and sides</Link>.
        </Typography>
          : <DockCaption isOn={ isOn }/> }
      { onRetry ? <Button
        aria-disabled={ isUpdating || undefined }
        onClick={ () => { if (!isUpdating) onRetry(); } }
        sx={ powerPillSx('off') }>
        Try again
      </Button>
        : !message && !away && <PowerButton isOn={ isOn } refetch={ refetch }/> }
    </Box>
  );
}
