import { Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { LastNight } from './useLastNight.ts';

export default function LastNightChip({ lastNight }: { lastNight?: LastNight }) {
  const navigate = useNavigate();
  if (!lastNight) return null;

  return (
    <Button
      fullWidth
      onClick={ () => navigate('/sleep') }
      // Same surface and text inset as the Tonight card above it.
      sx={ { justifyContent: 'space-between', gap: 1, px: 2, minHeight: 48, color: 'text.secondary', bgcolor: 'background.paper',
        border: 1, borderColor: 'divider' } }>
      <Typography component="span" variant="body2" sx={ { textAlign: 'left' } }>
        Last night's sleep estimate: { lastNight.score }
      </Typography>
      <Typography component="span" variant="body2" color="primary" sx={ { whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500 } }>
        View sleep
      </Typography>
    </Button>
  );
}
