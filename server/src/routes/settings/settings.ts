import _ from 'lodash';
import express, { Request, Response } from 'express';
import logger from '../../logger.js';

const router = express.Router();

import settingsDB from '../../db/settings.js';
import { SettingsSchema } from '../../db/settingsSchema.js';
import { wouldOrphanLevelFormat } from './settingsGuards.js';

router.get('/settings', async (req: Request, res: Response) => {
  await settingsDB.read();
  res.json(settingsDB.data);
});


router.post('/settings', async (req: Request, res: Response) => {
  const { body } = req;
  const validationResult = SettingsSchema.deepPartial().safeParse(body);
  if (!validationResult.success) {
    logger.error('Invalid settings update:', validationResult.error);
    res.status(400).json({
      error: 'Invalid request data',
      details: validationResult?.error?.errors,
    });
    return;
  }
  // Merge the validated/stripped result, not the raw body: some nested
  // schemas here aren't `.strict()`, so extra attacker-supplied properties
  // on those nested objects pass validation and would otherwise be written
  // into settingsDB.data verbatim if the raw body were merged instead.
  const validatedUpdate = validationResult.data;
  delete validatedUpdate.id;
  await settingsDB.read();

  if (wouldOrphanLevelFormat(settingsDB.data, validatedUpdate)) {
    res.status(409).json({
      error: 'Set temperature display away from Level before disabling this feature',
    });
    return;
  }

  _.merge(settingsDB.data, validatedUpdate);
  await settingsDB.write();
  res.status(200).json(settingsDB.data);
});


export default router;
