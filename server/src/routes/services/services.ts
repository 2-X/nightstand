import express, { Request, Response } from 'express';
import logger from '../../logger.js';

const router = express.Router();

import servicesDB, { updateServices } from '../../db/services.js';
import { PrivilegedCommandError } from '../../jobs/privilegedCommand.js';
import { ServicesSchema } from '../../db/servicesSchema.js';
import { shouldDisableBiometrics, triggerBiometricsDisable } from '../../jobs/biometrics.js';

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

  // Flipping biometrics off must actually stop the stream service, not just
  // flip the DB flag primeScheduler/powerScheduler read to skip scheduling
  // (see scripts/disable_biometrics.sh). Idempotent, so it's safe to fire on
  // every `enabled: false` write rather than diffing against the prior value.
  if (shouldDisableBiometrics(validationResult.data)) {
    try {
      await triggerBiometricsDisable();
    } catch (error) {
      logger.error('Failed to disable biometrics', error);
      res.status(500).json({ error: error instanceof PrivilegedCommandError ? error.message : 'Unable to disable biometrics' });
      return;
    }
  }

  // Merge the validated/stripped result, not the raw body: StatusInfoSchema
  // (nested under biometrics.jobs.*) isn't `.strict()`, so extra properties
  // on a job status object would otherwise pass validation and get written
  // verbatim. Same bug class settings.ts's POST route was already fixed for.
  for (const job of Object.values(validationResult.data.biometrics?.jobs ?? {})) {
    if (typeof job?.message === 'string') job.message = shortenMessage(job.message);
  }
  const data = await updateServices(validationResult.data);

  res.status(200).json(data);
});


export default router;
