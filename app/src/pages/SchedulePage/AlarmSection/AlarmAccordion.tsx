import {
  Accordion,
  AccordionSummary,
  Box,
  Chip,
  Typography,
  SxProps,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { AccordionExpanded } from '../SchedulePage.types.ts';
import { useScheduleStore } from '../scheduleStore.tsx';
import AlarmEnabledSwitch from './AlarmEnabledSwitch.tsx';
import AlarmTime from './AlarmTime.tsx';
import AlarmVibrationSlider from './AlarmVibrationSlider.tsx';
import AlarmDuration from './AlarmDuration.tsx';
import AlarmPattern from './AlarmPattern.tsx';
import React from 'react';
import AlarmIcon from '@mui/icons-material/Alarm';
import AlarmTest from './AlarmTest.tsx';

const ACCORDION_NAME: AccordionExpanded = 'alarm';

const Row = ({ children, sx }: React.PropsWithChildren<{ sx?: SxProps }>) => (
  <Box
    sx={ {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      mb: 2,
      pl: 2,
      pr: 2,
      gap: 1,
      ...sx,
    } }
  >
    { children }
  </Box>
);

// eslint-disable-next-line react/no-multi-comp
export default function AlarmAccordion() {
  const {
    accordionExpanded,
    selectedSchedule,
    setAccordionExpanded,
    selectedAlarmIndex,
    selectAlarm,
    getEditedAlarms,
    addAlarm,
    removeAlarm,
  } = useScheduleStore();

  const alarms = getEditedAlarms();
  const alarmEnabled = !!alarms[selectedAlarmIndex]?.enabled;

  return (
    <Accordion
      sx={ { width: '100%', mt: -2 } }
      expanded={ accordionExpanded === ACCORDION_NAME }
      onChange={ () => setAccordionExpanded(ACCORDION_NAME) }
      disabled={ !selectedSchedule?.power.enabled }
    >
      <AccordionSummary expandIcon={ <ExpandMoreIcon/> } >
        <Typography sx={ { display: 'flex', alignItems: 'center', gap: 3 } }>
          <AlarmIcon /> { alarms.length > 1 ? 'Vibration alarms' : 'Vibration alarm' }
        </Typography>
      </AccordionSummary>
      <Box sx={ { width: '100%', pb: 2 } }>
        <Row sx={ { justifyContent: 'flex-start', flexWrap: 'wrap', gap: 0.75 } }>
          { alarms.map((alarm, index) => (
            <Chip
              key={ index }
              label={ alarm.enabled ? alarm.time : `${alarm.time} (off)` }
              variant={ index === selectedAlarmIndex ? 'filled' : 'outlined' }
              color={ index === selectedAlarmIndex ? 'primary' : 'default' }
              onClick={ () => selectAlarm(index) }
              onDelete={ alarms.length > 1 ? () => removeAlarm(index) : undefined }
              size="small"
            />
          )) }
          <Chip
            label="+ Add"
            variant="outlined"
            size="small"
            onClick={ addAlarm }
          />
        </Row>
        <Row>
          <AlarmEnabledSwitch/>
          { alarmEnabled && <AlarmTime/> }
        </Row>
        {
          alarmEnabled &&
          (
            <>
              <Row>
                <AlarmDuration/>
                <AlarmPattern/>
              </Row>
              <Row sx={ { ml: 3, mr: 3 } }>
                <AlarmVibrationSlider/>

              </Row>
              <AlarmTest />
            </>
          )
        }
      </Box>
    </Accordion>
  );

}
