import express from 'express';
import { AlarmJobSchema, } from '../../db/schedulesSchema.js';
import logger from '../../logger.js';
import schedulesDB from '../../db/schedules.js';
import { executeAlarm } from '../../jobs/alarmScheduler.js';
const router = express.Router();
router.post('/alarm', async (req, res) => {
    const body = req.body;
    const validationResult = AlarmJobSchema.safeParse(body);
    if (!validationResult.success) {
        logger.error('Invalid schedules update:', validationResult.error);
        res.status(400).json({
            error: 'Invalid request data',
            details: validationResult?.error?.errors,
        });
        return;
    }
    const alarmJob = validationResult.data;
    // Answer after the start command, so a Pod that could not be reached is not reported as ringing.
    const ringMs = await executeAlarm(alarmJob);
    if (!ringMs) {
        res.status(503).json({ error: { message: 'The alarm did not start. Try again in a moment.' } });
        return;
    }
    res.status(200).json(schedulesDB.data);
});
export default router;
//# sourceMappingURL=alarm.js.map