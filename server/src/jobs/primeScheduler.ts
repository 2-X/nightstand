import schedule from 'node-schedule';
import { Settings } from '../db/settingsSchema.js';
import logger from '../logger.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';


export const schedulePriming = (settingsData: Settings) => {
  const { timeZone, primePodDaily } = settingsData;
  if (timeZone === null) return;
  if (!primePodDaily.enabled) return;
  const dailyRule = new schedule.RecurrenceRule();
  const { time } = primePodDaily;
  const [onHour, onMinute] = time.split(':').map(Number);
  dailyRule.hour = onHour;
  dailyRule.minute = onMinute;
  dailyRule.tz = timeZone;

  logger.debug(`Scheduling daily prime job at ${primePodDaily.time}`);
  schedule.scheduleJob(`daily-priming-${time}`, dailyRule, async () => {
    logger.info(`Executing scheduled prime job`);
    await updateDeviceStatus({ isPriming: true });
  });
};
