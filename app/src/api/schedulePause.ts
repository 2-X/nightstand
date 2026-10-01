// The server's job gates use the same helpers, so both read a pause alike.
export { isAlarmPaused, isSchedulePaused, pauseEndsAt } from '../../../server/src/jobs/schedulePause.ts';
