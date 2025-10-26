
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="e022964b-443d-5f68-9062-5c28b1e0b4f8")}catch(e){}}();
import express from 'express';
import logger from '../../logger.js';
import { executeAnalyzeSleep } from '../../jobs/analyzeSleep.js';
import { executeCalibrateSensors } from '../../jobs/calibrateSensors.js';
import moment from 'moment-timezone';
import { JobKeyListSchema } from './jobsSchema.js';
const router = express.Router();
const analyzeSleepLeft = () => executeAnalyzeSleep('left', moment().subtract(12, 'hours').toISOString(), moment().add(1, 'hours').toISOString());
const analyzeSleepRight = () => executeAnalyzeSleep('right', moment().subtract(12, 'hours').toISOString(), moment().add(1, 'hours').toISOString());
const biometricsCalibrationLeft = () => executeCalibrateSensors('left', moment().subtract(2, 'hours').toISOString(), moment().add(1, 'hours').toISOString());
const biometricsCalibrationRight = () => executeCalibrateSensors('right', moment().subtract(2, 'hours').toISOString(), moment().add(1, 'hours').toISOString());
const JOB_MAP = {
    analyzeSleepLeft,
    analyzeSleepRight,
    biometricsCalibrationLeft,
    biometricsCalibrationRight,
};
router.post('/jobs', async (req, res) => {
    const { body } = req;
    const validationResult = JobKeyListSchema.safeParse(body);
    if (!validationResult.success) {
        logger.error('Invalid jobs:', validationResult.error);
        res.status(400).json({
            error: 'Invalid request data',
            details: validationResult?.error?.errors,
        });
        return;
    }
    body.forEach((job) => {
        logger.debug(`Would execute job: ${job}`);
        JOB_MAP[job]();
    });
    res.status(204).end();
});
export default router;
//# sourceMappingURL=jobs.js.map
//# debugId=e022964b-443d-5f68-9062-5c28b1e0b4f8
