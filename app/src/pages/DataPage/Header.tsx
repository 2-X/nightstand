import { ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { Link } from 'react-router-dom';

type HeaderProps = { title: string; icon: ReactNode; backTo?: string; backLabel?: string };

export default function Header({ title, icon, backTo = '/settings', backLabel = 'Back to Settings' }: HeaderProps) {
  return <Box sx={ { width: '100%', mb: 1 } }>
    <Button component={ Link } to={ backTo } startIcon={ <NavigateBeforeIcon/> }>{ backLabel }</Button>
    <Typography component="h1" variant="h1" sx={ { display: 'flex', alignItems: 'center', gap: 1, mt: 1 } }>
      { icon }{ title }
    </Typography>
  </Box>;
}
