import express, { Request, Response } from 'express';
import logger from '../../logger.js';

const router = express.Router();

import servicesDB, { updateServices } from '../../db/services.js';
import { PrivilegedCommandError, privilegedErrorStatus } from '../../jobs/privilegedCommand.js';
import { ServicesSchema } from '../../db/servicesSchema.js';
import { syncBiometrics } from '../../jobs/biometricsSync.js';
import {
  shouldDisableBiometrics, shouldEnableBiometrics, triggerBiometricsDisable, triggerBiometricsEnable,
} from '../../jobs/biometrics.js';

// Job messages are stored and pushed to every client, so a long traceback is
// cut to its start and end, which hold the context and the error.
export const MAX_JOB_MESSAGE_LENGTH = 4_000;
const shortenMessage = (message: string) => {
  if (message.length <= MAX_JOB_MESSAGE_LENGTH) return message;
  const marker = '\n...\n';
  const half = (MAX_JOB_MESSAGE_LENGTH - marker.length) / 2;
  return `${message.slice(0, half)}${marker}${message.slice(-half)}`;
};

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

  // Merge the validated/stripped result, not the raw body: StatusInfoSchema
  // (nested under biometrics.jobs.*) isn't `.strict()`, so extra properties
  // on a job status object would otherwise pass validation and get written
  // verbatim. Same bug class settings.ts's POST route was already fixed for.
  for (const job of Object.values(validationResult.data.biometrics?.jobs ?? {})) {
    if (typeof job?.message === 'string') job.message = shortenMessage(job.message);
  }
  const save = () => updateServices(validationResult.data);

  // Flipping biometrics off must actually stop the stream service, not just
  // flip the DB flag primeScheduler/powerScheduler read to skip scheduling
  // (see scripts/disable_biometrics.sh), and turning it on starts the stream.
  // The flag is saved in the same queued step, only once the command worked.
  const turnOff = shouldDisableBiometrics(validationResult.data);
  if (!turnOff && !shouldEnableBiometrics(validationResult.data)) {
    const saved = await save();
    await syncBiometrics();
    res.status(200).json(saved);
    return;
  }
  let data;
  try {
    data = await (turnOff ? triggerBiometricsDisable(save) : triggerBiometricsEnable(save));
  } catch (error) {
    logger.error(`Failed to ${turnOff ? 'disable' : 'enable'} biometrics`, error);
    const fallback = `Unable to ${turnOff ? 'disable' : 'enable'} biometrics`;
    res.status(privilegedErrorStatus(error)).json({ error: error instanceof PrivilegedCommandError ? error.message : fallback });
    return;
  }

  await syncBiometrics();
  res.status(200).json(data);
});


export default router;
