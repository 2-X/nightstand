import axios, { HARDWARE_REQUEST_TIMEOUT_MS } from './api';
import type { AlarmJob } from '../../../server/src/db/schedulesSchema.ts';


export const postAlarm = (alarmJob: AlarmJob) => {
  return axios.post('/alarm', alarmJob, { timeout: HARDWARE_REQUEST_TIMEOUT_MS });
};
