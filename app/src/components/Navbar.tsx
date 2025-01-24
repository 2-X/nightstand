import React, { useEffect } from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import HomeIcon from '@mui/icons-material/Home';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore, Side } from '@state/appStore.tsx';
import { useTheme } from '@mui/material/styles';

type Page = {
  title: string;
  route: string;
  icon: React.ReactElement;
  side: Side | undefined;
};

const pages: Page[] = [
  { title: 'Left Side', route: '/left/', icon: <HomeIcon/>, side: 'left' },
  { title: 'Right Side', route: '/right/', icon: <HomeIcon/>, side: 'right' },
  { title: 'Schedules', route: '/schedules/', icon: <ScheduleIcon/>, side: undefined },
  { title: 'Settings', route: '/settings/', icon: <SettingsIcon/>, side: undefined },
];

export default function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isUpdating, setSide } = useAppStore();
  const theme = useTheme(); // Access the Material-UI theme
  const currentTitle = pages.find((page) => page.route === pathname)?.title;
  const [mobileNavValue, setMobileNavValue] = React.useState(
    pages.findIndex((page) => page.route === pathname)
  );

  useEffect(() => {
    const page = pages.find((page) => page.route === pathname);
    if (page?.side) setSide(page.side);
  }, [pathname]);

  // Handle navigation for both desktop and mobile
  const handleNavigation = (route: string, newSide: Side | undefined) => {
    if (newSide) setSide(newSide);
    navigate(route);
  };

  const handleMobileNavChange = (_event: React.SyntheticEvent, newValue: number) => {
    setMobileNavValue(newValue);
    handleNavigation(pages[newValue].route, pages[newValue]?.side);
  };

  const gradient = `linear-gradient(
  90deg,
  ${theme.palette.background.default},
  ${theme.palette.primary.dark},
  ${theme.palette.background.default},
  ${theme.palette.primary.dark},
  ${theme.palette.background.default}
)`;
  return (
    <>
      {/* Loading Bar */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '20px',
          background: isUpdating ? gradient : 'transparent',
          backgroundSize: '200% 100%',
          animation: isUpdating ? 'slide-gradient 4s linear infinite reverse' : 'none',
          zIndex: 1201,
        }}
      />
      {/* Desktop Navigation */}
      <AppBar
        position="static"
        color="transparent"
        sx={{
          display: { xs: 'none', md: 'flex' },
          borderTop: `1px solid ${theme.palette.grey[700]}`,
          boxShadow: 'none',
        }}
      >
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {currentTitle || 'App Title'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {pages.map(({ title, route, side: newSide }) => (
              <Button
                key={route}
                onClick={() => handleNavigation(route, newSide)}
                sx={{ color: 'white' }}
                variant={pathname === route ? 'outlined' : 'text'}
                disabled={isUpdating}
              >
                {title}
              </Button>
            ))}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Bottom Navigation */}
      <Box
        sx={{
          display: { xs: 'flex', md: 'none' },
          width: '100%',
          position: 'fixed',
          bottom: 0,
          height: '80px',
          justifyContent: 'space-between',
          borderTop: `1px solid ${theme.palette.grey[700]}`,
          backgroundColor: theme.palette.background.default,
        }}
      >
        <BottomNavigation
          value={mobileNavValue}
          onChange={handleMobileNavChange}
          sx={{ width: '100%', backgroundColor: theme.palette.background.default }}
        >
          {pages.map(({ title, icon }, index) => (
            <BottomNavigationAction
              key={index}
              label={title}
              icon={icon}
              disabled={isUpdating}
            />
          ))}
        </BottomNavigation>
      </Box>
      <style>
        {`
@keyframes slide-gradient {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 200% 50%;
  }
}

        `}
      </style>
    </>
  );
}
