import express from 'express';
import { prisma } from '../../db/prisma.js';
import logger from '../../logger.js';
import { buildCalibrationView } from './calibrationView.js';
const router = express.Router();
const SIDES = ['left', 'right'];
router.get('/', async (_req, res) => {
    try {
        const result = {};
        for (const side of SIDES) {
            const profile = await prisma.calibration_profiles.findFirst({
                where: { side, sensor_type: 'cap' },
            });
            // The run that actually produced the active profile, not whichever run
            // is most recent: a later skip or failure must not flip an imported
            // profile's state.
            const originatingRun = profile
                ? await prisma.calibration_runs.findUnique({ where: { id: profile.run_id } })
                : null;
            const lastRun = await prisma.calibration_runs.findFirst({
                where: { side, sensor_type: 'cap' },
                orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
            });
            result[side] = buildCalibrationView(profile, originatingRun, lastRun);
        }
        res.json(result);
    }
    catch (error) {
        logger.error(error);
        res.status(500).json({ error: { message: 'Unable to read calibration state' } });
    }
});
export default router;
//# sourceMappingURL=calibration.js.map