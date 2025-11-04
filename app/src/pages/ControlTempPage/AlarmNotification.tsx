import moment from 'moment-timezone';
import AlarmIcon from '@mui/icons-material/Alarm';
import { Alert } from '@mui/material';

import { useAppStore } from '@state/appStore.tsx';
import { useSchedules } from '@api/schedules.ts';
import { useSettings } from '@api/settings.ts';


export default function AlarmNotification() {
  const { side } = useAppStore();
  const { data: schedules } = useSchedules();
  const { data: settings } = useSettings();
  const currentDay = settings?.timeZone && moment.tz(settings.timeZone).format('dddd').toLowerCase();
  if (!currentDay) return null;
  // @ts-expect-error
  const power = schedules?.[side]?.[currentDay]?.power;
  // @ts-expect-error
  const alarm = schedules?.[side]?.[currentDay].alarm;

  if (!power?.enabled || !alarm?.enabled) return null;
  const alarmTime = moment(alarm?.time, 'HH:mm').format('h:mm A');

  return (
    <>
      <Alert
        icon={ <AlarmIcon /> }
        severity="warning"
        sx={ {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          '& .MuiAlert-message': { flexGrow: 1, width: '100%' }
        } }
      >
      Alarm at { alarmTime }
      </Alert>
    </>
  );
}
