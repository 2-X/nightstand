import { Box, Button } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useBaseConfigured } from '@api/baseControl.ts';

export default function BedTabs() {
  const configured = useBaseConfigured();
  const { pathname } = useLocation();
  const selectedPath = pathname === '/elevation' ? '/elevation' : '/';
  if (configured === false) return null;
  const destinations = [{ to: '/', label: 'Temperature' }, { to: '/elevation', label: 'Elevation' }];
  // Until the base check answers, the row keeps its space so the page below does not jump when it appears.
  const pending = configured === undefined;
  return (
    <Box
      component="nav"
      aria-label="Bed controls"
      aria-hidden={ pending || undefined }
      sx={ { display: 'flex', width: '100%', px: 0, borderBottom: 1, borderColor: 'divider', visibility: pending ? 'hidden' : undefined } }>
      { destinations.map(({ to, label }) => <Button
        key={ to }
        component={ Link }
        to={ to }
        aria-current={ selectedPath === to ? 'page' : undefined }
        sx={ { minHeight: 44, flex: 1, px: 0, borderRadius: 0, borderBottom: 2,
          borderColor: selectedPath === to ? 'primary.main' : 'transparent',
          color: selectedPath === to ? 'primary.main' : 'text.secondary' } }
      >{ label }</Button>) }
    </Box>
  );
}
