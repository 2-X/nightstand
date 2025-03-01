import { exec } from 'child_process';
import schedule from 'node-schedule';
import logger from '../logger.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { executeCalibrateSensors } from './calibrateSensors.js';
import moment from 'moment-timezone';
import settingsDB from '../db/settings.js';
const scheduleRebootJob = (onHour, onMinute, timeZone) => {
    const dailyRule = new schedule.RecurrenceRule();
    dailyRule.hour = onHour;
    dailyRule.minute = onMinute;
    dailyRule.tz = timeZone;
    const time = `${String(onHour).padStart(2, '0')}:${String(onMinute).padStart(2, '0')}`;
    logger.debug(`Scheduling daily reboot job at ${time}`);
    schedule.scheduleJob(`daily-reboot-${time}`, dailyRule, async () => {
        await settingsDB.read();
        if (!settingsDB.data.rebootDaily) {
            logger.info('Daily reboot job is disabled, skipping...');
        }
        logger.info(`Executing scheduled reboot job`);
        exec('sudo /sbin/reboot', (error, stdout, stderr) => {
            if (error) {
                logger.error(`Error: ${error.message}`);
                return;
            }
            if (stderr) {
                logger.error(`Stderr: ${stderr}`);
                return;
            }
            logger.debug(`Stdout: ${stdout}`);
        });
    });
};
const scheduleCalibrationJob = (onHour, onMinute, timeZone, side) => {
    const dailyRule = new schedule.RecurrenceRule();
    dailyRule.hour = onHour;
    dailyRule.minute = onMinute;
    dailyRule.tz = timeZone;
    const time = `${String(onHour).padStart(2, '0')}:${String(onMinute).padStart(2, '0')}`;
    logger.debug(`Scheduling daily calibration job at ${time} for ${side}`);
    schedule.scheduleJob(`daily-calibration-${time}-${side}`, dailyRule, async () => {
        logger.info(`Executing scheduled calibration job for ${side}`);
        executeCalibrateSensors(side, moment().subtract(6, 'hours').toISOString(), moment().toISOString());
    });
};
export const schedulePrimingRebootAndCalibration = (settingsData) => {
    const { timeZone, primePodDaily } = settingsData;
    if (timeZone === null)
        return;
    if (!primePodDaily.enabled)
        return;
    const dailyRule = new schedule.RecurrenceRule();
    const { time } = primePodDaily;
    const [onHour, onMinute] = time.split(':').map(Number);
    dailyRule.hour = onHour;
    dailyRule.minute = onMinute;
    dailyRule.tz = timeZone;
    scheduleRebootJob(onHour - 2, onMinute, timeZone);
    scheduleCalibrationJob(onHour, 0, timeZone, 'left');
    scheduleCalibrationJob(onHour, 30, timeZone, 'right');
    logger.debug(`Scheduling daily prime job at ${primePodDaily.time}`);
    schedule.scheduleJob(`daily-priming-${time}`, dailyRule, async () => {
        logger.info(`Executing scheduled prime job`);
        await updateDeviceStatus({ isPriming: true });
    });
};
