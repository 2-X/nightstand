import schedule from 'node-schedule';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { getDayOfWeekIndex, getPowerOffDayIndex, logJob } from './utils.js';
import { executeAnalyzeSleep } from './analyzeSleep.js';
import moment from 'moment-timezone';
import serverStatus from '../serverStatus.js';
import logger from '../logger.js';
import servicesDB from '../db/services.js';
import memoryDB from '../db/memoryDB.js';
import settingsDB from '../db/settings.js';
import { isTempScheduleOverridden } from './scheduleOverride.js';
import { SLEEP_ANALYSIS_HOUR, SLEEP_ANALYSIS_MINUTE } from '../sleepAnalysisSchedule.js';
import { letAlarmsFinish } from './alarmActivity.js';
// Minute of each side's latest scheduled power-on. A power-off due in that
// minute or earlier ends the night before, and must not switch off the
// session the power-on just started.
const lastPowerOn = new Map();
const minuteOf = (date) => Math.floor(date.getTime() / 60_000) * 60_000;
// Test isolation only.
export const resetPowerOnTimes = () => lastPowerOn.clear();
export const schedulePowerOn = (settingsData, side, day, power) => {
    if (!power.enabled)
        return;
    if (settingsData[side].awayMode)
        return;
    if (settingsData.timeZone === null)
        return;
    const onRule = new schedule.RecurrenceRule();
    const dayOfWeekIndex = getDayOfWeekIndex(day);
    onRule.dayOfWeek = dayOfWeekIndex;
    const [onHour, onMinute] = power.on.split(':').map(Number);
    const time = power.on;
    onRule.hour = onHour;
    onRule.minute = onMinute;
    onRule.tz = settingsData.timeZone;
    logJob('Scheduling power on job', side, day, dayOfWeekIndex, time);
    schedule.scheduleJob(`${side}-${day}-${time}-power-on`, onRule, async (fireDate) => {
        lastPowerOn.set(side, minuteOf(fireDate ?? new Date()));
        try {
            logJob('Executing power on job', side, day, dayOfWeekIndex, time);
            // A manual temperature change pauses the schedule's temperature control,
            // so turn the side on but leave the user's chosen temperature in place.
            // Applying onTemperature here would undo the override minutes after the
            // user set it, which is exactly what the temperature jobs already avoid.
            await settingsDB.read();
            const overridden = isTempScheduleOverridden(side);
            if (overridden) {
                logJob('Temperature schedule overridden, powering on without setting temperature', side, day, dayOfWeekIndex, time);
            }
            await updateDeviceStatus({
                [side]: overridden
                    ? { isOn: true }
                    : { isOn: true, targetTemperatureF: power.onTemperature },
            }, { background: true });
            serverStatus.status.powerSchedule.status = 'healthy';
            serverStatus.status.powerSchedule.message = '';
        }
        catch (error) {
            serverStatus.status.powerSchedule.status = 'failed';
            const message = error instanceof Error ? error.message : String(error);
            serverStatus.status.powerSchedule.message = message;
            logger.error(error);
        }
    });
};
// Analyze a full sleep day for each side, independent of temperature schedules.
export const scheduleSleepAnalysis = (settingsData, side) => {
    if (settingsData[side].awayMode)
        return;
    if (settingsData.timeZone === null)
        return;
    const dailyRule = new schedule.RecurrenceRule();
    dailyRule.hour = SLEEP_ANALYSIS_HOUR;
    dailyRule.minute = SLEEP_ANALYSIS_MINUTE;
    dailyRule.tz = settingsData.timeZone;
    const time = `${String(SLEEP_ANALYSIS_HOUR).padStart(2, '0')}:${String(SLEEP_ANALYSIS_MINUTE).padStart(2, '0')}`;
    logger.debug(`Scheduling daily sleep-analyzer job for ${side} at ${time}`);
    schedule.scheduleJob(`daily-analyze-sleep-${side}`, dailyRule, async () => {
        await servicesDB.read();
        if (!servicesDB.data.biometrics.enabled) {
            logger.debug('Not executing sleep analyzer job, biometrics is disabled');
            return;
        }
        await memoryDB.read();
        const now = performance.now();
        if (memoryDB.data[side].analyzeSleep.lastRan) {
            const diffMs = now - memoryDB.data[side].analyzeSleep.lastRan;
            const tenMinutesMs = 10 * 60 * 1000;
            if (diffMs <= tenMinutesMs) {
                logger.debug(`Duplicate sleep-analyzer job for ${side}, skipping`);
                return;
            }
        }
        memoryDB.data[side].analyzeSleep.lastRan = now;
        await memoryDB.write();
        logger.info(`Executing daily sleep analyzer job for ${side}`);
        executeAnalyzeSleep(side, moment().subtract(24, 'hours').toISOString(), moment().add(1, 'hours').toISOString());
    });
};
export const schedulePowerOff = (settingsData, side, day, power) => {
    if (!power.enabled)
        return;
    if (settingsData[side].awayMode)
        return;
    if (settingsData.timeZone === null)
        return;
    const offRule = new schedule.RecurrenceRule();
    const dayOfWeekIndex = getPowerOffDayIndex(day, power);
    offRule.dayOfWeek = dayOfWeekIndex;
    const time = power.off;
    const [offHour, offMinute] = time.split(':').map(Number);
    offRule.hour = offHour;
    offRule.minute = offMinute;
    offRule.tz = settingsData.timeZone;
    logJob('Scheduling power off job', side, day, dayOfWeekIndex, time);
    schedule.scheduleJob(`${side}-${day}-${time}-power-off`, offRule, async (fireDate) => {
        try {
            logJob('Executing power off job', side, day, dayOfWeekIndex, time);
            // An alarm in this minute rings first and the side turns off after it;
            // otherwise the alarm would find the side already off and skip.
            const dueAt = fireDate ?? new Date();
            await letAlarmsFinish(side, day, dueAt);
            if ((lastPowerOn.get(side) ?? -Infinity) >= minuteOf(dueAt)) {
                logJob('Skipping power off, the next session already started', side, day, dayOfWeekIndex, time);
                return;
            }
            await updateDeviceStatus({
                [side]: {
                    isOn: false,
                }
            }, { background: true });
            serverStatus.status.powerSchedule.status = 'healthy';
            serverStatus.status.powerSchedule.message = '';
        }
        catch (error) {
            serverStatus.status.powerSchedule.status = 'failed';
            const message = error instanceof Error ? error.message : String(error);
            serverStatus.status.powerSchedule.message = message;
            logger.error(error);
        }
    });
};
//# sourceMappingURL=powerScheduler.js.map