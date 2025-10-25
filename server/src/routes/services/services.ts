import _ from 'lodash';
import express, { Request, Response } from 'express';
import logger from '../../logger.js';

const router = express.Router();

import servicesDB from '../../db/services.js';
import { ServicesSchema } from '../../db/servicesSchema.js';

router.get('/services', async (req: Request, res: Response) => {
  await servicesDB.read();
  res.json(servicesDB.data);
});


router.post('/services', async (req: Request, res: Response) => {
  const { body } = req;
  const validationResult = ServicesSchema.deepPartial().safeParse(body);
  if (!validationResult.success) {
    logger.error('Invalid services update:', validationResult.error);
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult?.error?.errors,
    });
    return;
  }
  await servicesDB.read();
  _.merge(servicesDB.data, body);
  await servicesDB.write();
  res.status(200).json(servicesDB.data);
});


export default router;
