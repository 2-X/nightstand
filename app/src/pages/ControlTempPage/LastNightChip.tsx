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
      sx={ { justifyContent: 'space-between', gap: 1, px: 1.5, color: 'text.secondary', bgcolor: 'background.paper' } }>
      <Typography component="span" variant="body2" sx={ { whiteSpace: 'nowrap' } }>Last night estimate { lastNight.score }</Typography>
      <Typography component="span" variant="body2" sx={ { whiteSpace: 'nowrap' } }>View sleep</Typography>
    </Button>
  );
}
