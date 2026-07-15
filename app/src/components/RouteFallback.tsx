import { Box, CircularProgress } from '@mui/material';

// Centred spinner while a route chunk is downloading. Kept tiny on purpose,
// it gets shown for sub-second loads on the LAN, so fanfare would feel laggy.
export default function RouteFallback() {
  return (
    <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' } }>
      <CircularProgress />
    </Box>
  );
}
