import { Link } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { sx as shared } from '@design/tokens';
import { lastNightText } from './lastNightText';
import type { LastNight } from './useLastNight.ts';

// A quiet line on the controls row while the side is off, centred in the row's full height.
export default function LastNightSummary({ lastNight }: { lastNight?: LastNight }) {
  const text = lastNight && lastNightText(lastNight);
  if (!text) return null;
  return (
    <Box
      sx={ {
        height: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center',
        justifyContent: 'center', columnGap: '4px', textAlign: 'center',
      } }>
      <Typography component="span" sx={ { fontSize: 15, color: 'text.secondary', whiteSpace: 'nowrap' } }>{ text }</Typography>
      <Button component={ Link } to="/sleep" aria-label="View last night's sleep" sx={ shared.lampLink }>View sleep</Button>
    </Box>
  );
}
