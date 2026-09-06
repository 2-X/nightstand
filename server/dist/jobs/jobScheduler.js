import path from 'path';
import chokidar from 'chokidar';
import moment from 'moment-timezone';
import schedule from 'node-schedule';
import config from '../config.js';
import logger from '../logger.js';
import schedulesDB from '../db/schedules.js';
import serverStatus from '../serverStatus.js';
import settingsDB from '../db/settings.js';
import { isSystemDateValid } from './isSystemDateValid.js';
import { scheduleAlarm, scheduleAlarmOverride, scheduleOneOffAlarm, scheduleRecurringAlarms } from './alarmScheduler.js';
import recurringAlarmsDB from '../db/recurringAlarms.js';
import { schedulePowerOff, schedulePowerOn, scheduleSleepAnalysis } from './powerScheduler.js';
import { schedulePrimingRebootAndCalibration } from './primeScheduler.js';
import { scheduleTemperatures } from './temperatureScheduler.js';
import eventBus from '../events/eventBus.js';
import { emitJobEvent } from './jobEvents.js';
import { isServicesDbChange } from './isServicesDbChange.js';
async function setupJobs() {
    try {
        if (serverStatus.status.jobs.status === 'started') {
            logger.debug('Job setup already running, skipping duplicate execution.');
            return;
        }
        serverStatus.status.jobs.status = 'started';
        // Clear existing jobs
        logger.info('Canceling old jobs...');
        Object.keys(schedule.scheduledJobs).forEach((jobName) => {
            schedule.cancelJob(jobName);
        });
        await schedule.gracefulShutdown();
        await settingsDB.read();
        await schedulesDB.read();
        await recurringAlarmsDB.read();
        moment.tz.setDefault(settingsDB.data.timeZone || 'UTC');
        const schedulesData = schedulesDB.data;
        const settingsData = settingsDB.data;
        logger.info('Scheduling jobs...');
        scheduleAlarmOverride(settingsData, 'left');
        scheduleAlarmOverride(settingsData, 'right');
        // Phase 2 recurring alarms own alarm scheduling once present; the legacy
        // per-day scheduleAlarm() inside the day loop stands down for those sides.
        scheduleRecurringAlarms(settingsData, 'left');
        scheduleRecurringAlarms(settingsData, 'right');
        if (settingsData.features.oneOffAlarms) {
            scheduleOneOffAlarm(settingsData, 'left');
            scheduleOneOffAlarm(settingsData, 'right');
        }
        // Sleep analysis runs daily per side, decoupled from power schedule:
        // a side that's being measured (biometrics on, person actually using
        // it) gets sleep records even when no temperature schedule is enabled
        // for that side. Was previously gated on power.enabled inside the
        // per-day loop, which silently skipped partners without heating
        // schedules.
        scheduleSleepAnalysis(settingsData, 'left');
        scheduleSleepAnalysis(settingsData, 'right');
        // Schedule each day independently. Old jobs are already cancelled by the
        // time we get here, so letting one malformed day throw would leave the pod
        // with no power, temperature or alarm jobs at all until something else
        // triggers a reschedule. Skip the bad day and keep the rest.
        let failedDays = 0;
        Object.entries(schedulesData).forEach(([side, sideSchedule]) => {
            Object.entries(sideSchedule).forEach(([day, schedule]) => {
                try {
                    schedulePowerOn(settingsData, side, day, schedule.power);
                    schedulePowerOff(settingsData, side, day, schedule.power);
                    scheduleTemperatures(settingsData, side, day, schedule.temperatures, schedule.power);
                    scheduleAlarm(settingsData, side, day, schedule);
                }
                catch (error) {
                    failedDays += 1;
                    const message = error instanceof Error ? error.message : String(error);
                    logger.error(`Failed to schedule ${side} ${day}, skipping it: ${message}`);
                }
            });
        });
        schedulePrimingRebootAndCalibration(settingsData);
        logger.info('Done scheduling jobs!');
        serverStatus.status.alarmSchedule.status = 'healthy';
        serverStatus.status.jobs.status = failedDays > 0 ? 'failed' : 'healthy';
        serverStatus.status.jobs.message = failedDays > 0
            ? `Skipped ${failedDays} unschedulable day(s), check the schedule data`
            : '';
        serverStatus.status.primeSchedule.status = 'healthy';
        serverStatus.status.powerSchedule.status = 'healthy';
        serverStatus.status.rebootSchedule.status = 'healthy';
        serverStatus.status.temperatureSchedule.status = 'healthy';
        emitJobEvent({ jobName: 'setupJobs', status: 'ok' });
        eventBus.emit('service-health', {
            jobs: serverStatus.status.jobs,
            alarmSchedule: serverStatus.status.alarmSchedule,
            primeSchedule: serverStatus.status.primeSchedule,
            powerSchedule: serverStatus.status.powerSchedule,
            rebootSchedule: serverStatus.status.rebootSchedule,
            temperatureSchedule: serverStatus.status.temperatureSchedule,
        });
    }
    catch (error) {
        serverStatus.status.jobs.status = 'failed';
        const message = error instanceof Error ? error.message : String(error);
        logger.error(error);
        serverStatus.status.jobs.message = message;
        emitJobEvent({ jobName: 'setupJobs', status: 'fail', message });
        eventBus.emit('service-health', { jobs: serverStatus.status.jobs });
    }
}
let RETRY_COUNT = 0;
const FAST_RETRIES = 20;
const FAST_RETRY_MS = 5_000;
// The pod boots before NTP has corrected the clock, and a sync can take much
// longer than the fast retries cover. Giving up permanently left the pod with
// no jobs at all until someone edited a schedule, so keep checking slowly.
const SLOW_RETRY_MS = 5 * 60 * 1000;
function waitForValidDateAndSetupJobs() {
    serverStatus.status.systemDate.status = 'started';
    if (isSystemDateValid()) {
        serverStatus.status.systemDate.status = 'healthy';
        serverStatus.status.systemDate.message = '';
        RETRY_COUNT = 0;
        logger.info('System date is valid. Setting up jobs...');
        void setupJobs();
        return;
    }
    const withinFastRetries = RETRY_COUNT < FAST_RETRIES;
    const delay = withinFastRetries ? FAST_RETRY_MS : SLOW_RETRY_MS;
    serverStatus.status.systemDate.status = 'retrying';
    const message = `System date is invalid (year 2010). No jobs scheduled yet, retrying in ${delay / 1000}s (attempt #${RETRY_COUNT})`;
    serverStatus.status.systemDate.message = message;
    RETRY_COUNT++;
    if (withinFastRetries) {
        logger.debug(message);
    }
    else {
        logger.warn(message);
    }
    setTimeout(waitForValidDateAndSetupJobs, delay).unref?.();
}
// Monitor the JSON file and refresh jobs on change
chokidar.watch(config.lowDbFolder).on('change', (changedPath) => {
    const fileName = path.basename(changedPath);
    if (isServicesDbChange(fileName)) {
        // servicesDB.json changes constantly (job status pings, sensor temps) and
        // never needs a reschedule, logging this no-op at info drowned out the
        // rare, actually-interesting reschedules in the production log.
        logger.debug(`Skipping restarting jobs for DB change: ${fileName}`);
        return;
    }
    else {
        logger.info(`Detected DB change, reloading... ${fileName}`);
    }
    if (serverStatus.status.systemDate.status === 'healthy') {
        void setupJobs();
    }
    else {
        waitForValidDateAndSetupJobs();
    }
});
// Initial job setup
waitForValidDateAndSetupJobs();
//# sourceMappingURL=jobScheduler.js.map