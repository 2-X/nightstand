import React from 'react';
import BarChartIcon from '@mui/icons-material/BarChart';
import BedIcon from '@mui/icons-material/Bed';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsIcon from '@mui/icons-material/Settings';
import BugReportIcon from '@mui/icons-material/BugReport';
import AirlineSeatReclineExtraIcon from '@mui/icons-material/AirlineSeatReclineExtra';

type Page = {
  title: string;
  route: string;
  icon: React.ReactElement;
};

function TemperatureIcon() {
  return (
    <span>
      <BedIcon sx={ { marginRight: '-6px' } }/>
      <ThermostatIcon />
    </span>
  );
}

export const PAGES: Page[] = [
  { title: 'Temperature', route: '/temperature', icon: <TemperatureIcon/> },
  { title: 'Schedules', route: '/schedules', icon: <ScheduleIcon/> },
  // Reclining-seat glyph reads as a tilted/raised bed posture better than a
  // flat bed icon.
  { title: 'Elevation', route: '/elevation', icon: <AirlineSeatReclineExtraIcon/> },

  { title: 'Data', route: '/data', icon: <BarChartIcon/> },
  { title: 'Status', route: '/status', icon: <BugReportIcon/> },
  { title: 'Settings', route: '/settings', icon: <SettingsIcon/> },
];
