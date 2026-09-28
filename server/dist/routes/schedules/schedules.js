import _ from 'lodash';
import express from 'express';
import logger from '../../logger.js';
import schedulesDB, { updateSchedules } from '../../db/schedules.js';
import { sanitizeScheduleBody } from './sanitizeScheduleBody.js';
import { SchedulesUpdateSchema, } from '../../db/schedulesSchema.js';
const router = express.Router();
const primaryAlarm = (alarms, fallback) => alarms[0] ?? {
    ...fallback,
    enabled: false,
};
router.get('/schedules', async (req, res) => {
    await schedulesDB.read();
    res.json(schedulesDB.data);
});
router.post('/schedules', async (req, res) => {
    const body = sanitizeScheduleBody(req.body);
    const validationResult = SchedulesUpdateSchema.safeParse(body);
    if (!validationResult.success) {
        logger.error('Invalid schedules update:', validationResult.error);
        res.status(400).json({
            error: 'Invalid request data',
            details: validationResult?.error?.errors,
        });
        return;
    }
    const schedules = validationResult.data;
    const saved = await updateSchedules(draft => {
        Object.entries(schedules).forEach(([side, sideSchedule]) => {
            Object.entries(sideSchedule).forEach(([day, schedule]) => {
                if (schedule.power) {
                    _.merge(draft[side][day].power, schedule.power);
                }
                if (schedule.temperatures)
                    draft[side][day].temperatures = schedule.temperatures;
                if (schedule.alarms) {
                    draft[side][day].alarms = schedule.alarms;
                    draft[side][day].alarm = primaryAlarm(draft[side][day].alarms, draft[side][day].alarm);
                }
                else if (schedule.alarm) {
                    draft[side][day].alarm = schedule.alarm;
                    draft[side][day].alarms = schedule.alarm.enabled ? [schedule.alarm] : [];
                }
            });
        });
    });
    res.status(200).json(saved);
});
export default router;
//# sourceMappingURL=schedules.js.map