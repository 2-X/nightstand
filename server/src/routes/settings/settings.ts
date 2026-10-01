import _ from 'lodash';
import express, { Request, Response } from 'express';
import logger from '../../logger.js';

const router = express.Router();

import settingsDB, { updateSettings } from '../../db/settings.js';
import { SettingsSchema } from '../../db/settingsSchema.js';
import { changesRhythmsFlag, pauseRejection, wouldOrphanLevelFormat } from './settingsGuards.js';
import { syncRawArchiveConf } from '../../jobs/rawArchiveConf.js';

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
  let conflict = '';
  const rejected: { error?: string } = {};
  const saved = await updateSettings(draft => {
    if (changesRhythmsFlag(draft, validatedUpdate)) {
      conflict = 'Use /rhythms/enable or /rhythms/disable to turn Rhythms on or off';
      return false;
    }
    if (wouldOrphanLevelFormat(draft, validatedUpdate)) {
      conflict = 'Set temperature display away from Level before disabling this feature';
      return false;
    }
    const pauseError = pauseRejection(draft, validatedUpdate, new Date());
    if (pauseError) {
      rejected.error = pauseError;
      return false;
    }
    _.merge(draft, validatedUpdate);
  }, async draft => {
    if (validatedUpdate.rawArchiveRetentionDays !== undefined) {
      await syncRawArchiveConf(draft.rawArchiveRetentionDays);
    }
  });
  if (conflict) {
    res.status(409).json({ error: conflict });
    return;
  }
  if (rejected.error) {
    res.status(400).json({ error: rejected.error });
    return;
  }
  res.status(200).json(saved);
});


export default router;
