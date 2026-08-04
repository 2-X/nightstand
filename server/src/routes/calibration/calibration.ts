import express, { Request, Response, Router } from 'express';
import { prisma } from '../../db/prisma.js';
import logger from '../../logger.js';
import { buildCalibrationView } from './calibrationView.js';

const router: Router = express.Router();

const SIDES = ['left', 'right'] as const;

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result: Record<string, unknown> = {};
    for (const side of SIDES) {
      const profile = await prisma.calibration_profiles.findFirst({
        where: { side, sensor_type: 'cap' },
      });
      const lastRun = await prisma.calibration_runs.findFirst({
        where: { side, sensor_type: 'cap' },
        orderBy: { started_at: 'desc' },
      });
      result[side] = buildCalibrationView(profile, lastRun);
    }
    res.json(result);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ error: { message: 'Unable to read calibration state' } });
  }
});

export default router;
