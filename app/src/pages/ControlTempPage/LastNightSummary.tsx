import { Link } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';

import type { LastNight } from './useLastNight.ts';

// A quiet line under the dial while the side is off.
export default function LastNightSummary({ lastNight }: { lastNight?: LastNight }) {
  if (!lastNight) return null;
  return (
    <Box
      sx={ {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        columnGap: 1,
        textAlign: 'center',
      } }>
      <Typography variant="body2" color="text.secondary">
        <Box component="span" sx={ { whiteSpace: 'nowrap' } }>Last night estimate { lastNight.score }</Box>
        { lastNight.duration && <> · <Box component="span" sx={ { whiteSpace: 'nowrap' } }>{ lastNight.duration }</Box></> }
      </Typography>
      <Button component={ Link } to="/sleep" size="small" sx={ { minWidth: 0 } }>View sleep</Button>
    </Box>
  );
}
