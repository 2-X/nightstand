import axios, { LONG_REQUEST_TIMEOUT_MS } from './api';
import { Jobs } from '../../../server/src/routes/jobs/jobsSchema.ts';
export * from '../../../server/src/routes/jobs/jobsSchema.ts';


export const postJobs = (jobs: Jobs) => {
  return axios.post('/jobs', jobs, { timeout: LONG_REQUEST_TIMEOUT_MS });
};
