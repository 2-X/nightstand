import schedule from 'node-schedule';
import logger from '../logger.js';
import { getDayOfWeekIndex } from './utils.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
const scheduleAdjustment = (timeZone, side, day, time, temperature) => {
    const onRule = new schedule.RecurrenceRule();
    onRule.dayOfWeek = getDayOfWeekIndex(day);
    const [onHour, onMinute] = time.split(':').map(Number);
    onRule.hour = onHour;
    onRule.minute = onMinute;
    onRule.tz = timeZone;
    logger.debug(`Scheduling temperature adjustment job for ${side} side on ${day} at ${time} at ${temperature}°F`);
    schedule.scheduleJob(`${side}-${day}-temperature-adjustment`, onRule, async () => {
        logger.info(`Executing scheduled temperature adjustment job for ${side} side on ${day} at ${time} at ${temperature}°F`);
        await updateDeviceStatus({
            [side]: {
                targetTemperatureF: temperature
            }
        });
    });
};
export const scheduleTemperatures = (settingsData, side, day, temperatures) => {
    if (settingsData[side].awayMode)
        return;
    const { timeZone } = settingsData;
    if (timeZone === null)
        return;
    Object.entries(temperatures).forEach(([time, temperature]) => {
        scheduleAdjustment(timeZone, side, day, time, temperature);
    });
};
