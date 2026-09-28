import { Box, Button } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useBaseConfigured } from '@api/baseControl.ts';

export default function BedTabs() {
  const configured = useBaseConfigured();
  const { pathname } = useLocation();
  const selectedPath = pathname === '/elevation' ? '/elevation' : '/';
  if (!configured && pathname !== '/elevation') return null;
  const destinations = [{ to: '/', label: 'Temperature' }, { to: '/elevation', label: 'Elevation' }];
  return (
    <Box component="nav" aria-label="Bed controls" sx={ { display: 'flex', width: '100%', maxWidth: 480, px: 2 } }>
      { destinations.map(({ to, label }) => <Button
        key={ to }
        component={ Link }
        to={ to }
        aria-current={ selectedPath === to ? 'page' : undefined }
        sx={ { minHeight: 48, px: 2, borderRadius: 0, borderBottom: 2,
          borderColor: selectedPath === to ? 'primary.main' : 'transparent',
          color: selectedPath === to ? 'primary.main' : 'text.secondary' } }
      >{ label }</Button>) }
    </Box>
  );
}
