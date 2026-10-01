import express, { Request, Response, Router } from 'express';
import { prisma } from '../../db/prisma.js';
import logger from '../../logger.js';
import { buildCalibrationView, newestFormatRun } from './calibrationView.js';

const router: Router = express.Router();

const SIDES = ['left', 'right'] as const;
// Runs look back this far for one that names a format.
const FORMAT_LOOKBACK_RUNS = 50;

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result: Record<string, unknown> = {};
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
      const formatRuns = await prisma.calibration_runs.findMany({
        where: { side, sensor_type: 'cap', payload: { not: null } },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        take: FORMAT_LOOKBACK_RUNS,
        select: { payload: true },
      });
      result[side] = buildCalibrationView(profile, originatingRun, lastRun, newestFormatRun(formatRuns));
    }
    res.json(result);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: { message: 'Unable to read calibration state' } });
  }
});

export default router;
