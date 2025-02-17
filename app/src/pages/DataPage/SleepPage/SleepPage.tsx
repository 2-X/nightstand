import moment from 'moment-timezone';
import { Box, Typography } from '@mui/material';
import { useResizeDetector } from 'react-resize-detector';

import PageContainer from '../../PageContainer.tsx';
import SleepBarChart from '../../../components/SleepBarChart.tsx';
import { useSleepRecords } from '@api/sleep.ts';
import { useAppStore } from '@state/appStore.tsx';
import { useState } from 'react';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useTheme } from '@mui/material/styles';
import BedIcon from '@mui/icons-material/Bed';
import Header from '../Header';

export default function SleepPage() {
  const { width = 300, ref } = useResizeDetector();
  const { side } = useAppStore();
  const [startTime, setStartTime] = useState(moment().subtract(7, 'days'));
  const [endTime, setEndTime] = useState(moment());

  // Fetch sleep records for the selected week
  const { data: sleepRecords, refetch } = useSleepRecords({
    side,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString()
  });

  // Function to move to the previous week
  const handlePrevWeek = () => {
    const newStartTime = startTime.clone().subtract(1, 'week');
    setStartTime(newStartTime);
    const newEndTime = endTime.clone().subtract(1, 'week');
    setEndTime(newEndTime);
  };

  // Function to move to the next week
  const handleNextWeek = () => {
    const newStartTime = startTime.clone().add(1, 'week');
    setStartTime(newStartTime);
    const newEndTime = endTime.clone().add(1, 'week');
    setEndTime(newEndTime);
  };
  const theme = useTheme();
  const isNextDisabled = endTime && moment(endTime).isSameOrAfter(moment(), 'week');

  return (
    <PageContainer containerProps={ { ref } } sx={ { mb: 15, gap: 1 } }>
      <Header title="Sleep" icon={ <BedIcon/> }/>
      <Box
        sx={ {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '80%',
          color: theme.palette.grey[500]
        } }>
        { /* Previous Button */ }
        <NavigateBeforeIcon onClick={ handlePrevWeek } sx={ { cursor: 'pointer' } }/>

        { /* Title - Always Centered */ }
        <Typography>
          { startTime.format('YYYY-MM-DD') } - { endTime.format('YYYY-MM-DD') }
        </Typography>

        { /* Next Button (Hidden but Maintains Space) */ }
        <Box sx={ { width: 24, display: 'flex', justifyContent: 'center' } }>
          { !isNextDisabled && (
            <NavigateNextIcon onClick={ handleNextWeek } sx={ { cursor: 'pointer' } }/>
          ) }
        </Box>
      </Box>
      <SleepBarChart width={ width } sleepRecords={ sleepRecords } refetch={ refetch }/>
    </PageContainer>
  );
}
