import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import BedTabs from './BedTabs';
import Box from '@mui/material/Box';


export default function Layout() {
  const { pathname } = useLocation();
  return (
    <Box
      id="Layout"
      sx={ {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        alignItems: 'center',
        gap: 2,
        // padding: 0,
        margin: 0,
        justifyContent: 'flex-start',
        pt: { xs: 1, md: 10 },
        pb: { xs: 'calc(80px + env(safe-area-inset-bottom, 0px))', md: 4 },
        minHeight: '100dvh',
      } }
    >
      { /* Renders current route */ }
      { ['/', '/temperature', '/elevation'].includes(pathname) && <BedTabs/> }
      <Outlet/>
      <Navbar/>
    </Box>
  );
}
