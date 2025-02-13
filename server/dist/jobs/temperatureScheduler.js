import schedule from 'node-schedule';
import logger from '../logger.js';
import { getDayOfWeekIndex, DAYS_OF_WEEK } from './utils.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
const scheduleAdjustment = (timeZone, side, day, time, temperature) => {
    const onRule = new schedule.RecurrenceRule();
    const [onHour, onMinute] = time.split(':').map(Number);
    let dayOfWeek = getDayOfWeekIndex(day);
    if (onHour <= 12) {
        dayOfWeek += 1;
        const nextDay = DAYS_OF_WEEK[dayOfWeek];
        logger.debug(`Scheduling temperature adjustment job for ${side} side on ${nextDay} morning at ${time} at ${temperature}°F`);
    }
    else {
        logger.debug(`Scheduling temperature adjustment job for ${side} side on ${day} night at ${time} at ${temperature}°F`);
    }
    onRule.dayOfWeek = dayOfWeek;
    onRule.hour = onHour;
    onRule.minute = onMinute;
    onRule.tz = timeZone;
    schedule.scheduleJob(`${side}-${day}-${time}-${temperature}-temperature-adjustment`, onRule, async () => {
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
