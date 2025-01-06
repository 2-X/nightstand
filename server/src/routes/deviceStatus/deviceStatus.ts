import express, { Request, Response } from 'express';
import { getFranken } from '../../8sleep/frankenServer.js';
import { DeviceStatusSchema } from './deviceStatusSchema.js';
import logger from '../../logger.js';
import { updateDeviceStatus } from './updateDeviceStatus.js';
import memoryDB from '../../db/memoryDB.js';

const router = express.Router();

router.get('/deviceStatus', async (req: Request, res: Response) => {
  const franken = await getFranken();
  const resp = await franken.getDeviceStatus();
  res.json(resp);
});


router.post('/deviceStatus', async (req: Request, res: Response) => {
  const { body } = req;
  const validationResult = DeviceStatusSchema.deepPartial().safeParse(body);
  if (!validationResult.success) {
    logger.error('Invalid device status update:', validationResult.error);
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult?.error?.errors,
    });
    return;
  }

  await updateDeviceStatus(body);
  res.status(200).json({ test: 1 });
});


export default router;
