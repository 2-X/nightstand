import { ReactNode } from 'react';
import { Box, Button, List, ListItemButton, ListItemText, Typography, useMediaQuery } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import { useTheme } from '@mui/material/styles';
import { Link, useLocation } from 'react-router-dom';
import { SETTINGS_CATEGORIES } from '../SettingsPage/settingsCategories';
import PageContainer from '../PageContainer.tsx';

type HeaderProps = { title: string; icon?: ReactNode; backTo?: string; backLabel?: string };

export default function Header({ title, backTo = '/settings', backLabel = 'Back to Settings' }: HeaderProps) {
  return <Box sx={ { width: '100%' } }>
    { backTo && <Button component={ Link } to={ backTo } startIcon={ <NavigateBeforeIcon/> } sx={ { mb: 1, minHeight: 44 } }>
      { backLabel }
    </Button> }
    <Typography component="h1" variant="h1">{ title }</Typography>
  </Box>;
}

// Shared reading width and heading for settings and diagnostic destinations.
// eslint-disable-next-line react/no-multi-comp
export function SubpageShell({ children, ...header }: HeaderProps & { children: ReactNode }) {
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'));
  const { pathname } = useLocation();
  const wide = pathname === '/settings/logs';
  return <Box sx={ { display: 'flex', width: '100%', maxWidth: wide ? 1440 : desktop ? 1040 : 720, mx: 'auto', alignItems: 'flex-start' } }>
    { desktop && header.backTo !== '' && <Box component="nav" aria-label="Settings categories" sx={ { width: 240, flexShrink: 0, p: 2 } }>
      <List>{ SETTINGS_CATEGORIES.map(({ key, title }) => <ListItemButton
        key={ key }
        component={ Link }
        to={ `/settings/${key}` }
        selected={ pathname === `/settings/${key}` }
        sx={ { minHeight: 48, borderRadius: 1 } }
      ><ListItemText primary={ title } /></ListItemButton>) }</List>
      <Button component={ Link } to="/settings/about">About and license</Button>
    </Box> }
    <PageContainer sx={ { minWidth: 0, alignItems: 'stretch', gap: 3, mb: 8, '&&': { maxWidth: wide ? 1200 : 720, mx: 'auto' } } }>
      <Header { ...header } />
      { children }
    </PageContainer>
  </Box>;
}
