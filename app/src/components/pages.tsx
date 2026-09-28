import type { ReactElement } from 'react';
import BedIcon from '@mui/icons-material/Bed';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsIcon from '@mui/icons-material/Settings';

export const PAGES: { title: string; route: string; icon: ReactElement }[] = [
  { title: 'Bed', route: '/', icon: <BedIcon /> },
  { title: 'Schedule', route: '/schedules', icon: <ScheduleIcon /> },
  { title: 'Sleep', route: '/sleep', icon: <NightsStayIcon /> },
  { title: 'Settings', route: '/settings', icon: <SettingsIcon /> },
];

export function primaryRoute(pathname: string): string {
  if (pathname === '/schedules') return '/schedules';
  if (pathname === '/sleep') return '/sleep';
  if (pathname.startsWith('/settings') || pathname === '/changelog') return '/settings';
  return '/';
}
