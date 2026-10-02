import { Link } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { palette, radius, sx as shared } from '@design/tokens';
import { lastNightText } from './lastNightText';
import type { LastNight } from './useLastNight.ts';

const chipSx = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: 52,
  p: '0 12px 0 22px', bgcolor: palette.bg.elevated, border: 1, borderColor: 'divider', borderRadius: `${radius.lg}px`,
} as const;

export default function LastNightChip({ lastNight }: { lastNight?: LastNight }) {
  const text = lastNight && lastNightText(lastNight);
  if (!text) return null;
  return (
    <Box data-last-night-chip sx={ chipSx }>
      <Typography component="span" sx={ { fontSize: 15, color: 'text.secondary' } }>{ text }</Typography>
      <Button component={ Link } to="/sleep" aria-label="View last night's sleep" sx={ shared.lampLink }>View sleep</Button>
    </Box>
  );
}
