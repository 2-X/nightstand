import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { useEventStreamStore } from '@api/eventStream';

export default function PageHeader({ title, status }: { title: string; status?: ReactNode }) {
  const reconnecting = useEventStreamStore(state => state.state === 'reconnecting');
  const detail = reconnecting ? 'Reconnecting' : status;
  return <Box sx={ { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 } }>
    <Typography component="h1" variant="h1">{ title }</Typography>
    { detail && <Typography
      role="status"
      variant="body2"
      color={ reconnecting ? 'warning.main' : 'text.secondary' }
      sx={ { textAlign: 'right' } }>{ detail }</Typography> }
  </Box>;
}
