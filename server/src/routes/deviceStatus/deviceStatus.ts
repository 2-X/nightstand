import express, { Request, Response } from 'express';
import { FrankenCommandTimeoutError, getDeviceStatusCoalesced, isFrankenConnected } from '../../8sleep/frankenServer.js';
import { DeviceStatus, DeviceStatusSchema } from './deviceStatusSchema.js';
import logger from '../../logger.js';
import { updateDeviceStatus } from './updateDeviceStatus.js';
import { markManualTempChange } from '../../jobs/scheduleOverride.js';
import { recordConfigAudit } from '../../db/collector.js';
import { DeepPartial } from 'ts-essentials';

const router = express.Router();

router.get('/deviceStatus', async (req: Request, res: Response) => {
  // Franken's initial hardware handshake can take ~25-30s (one connection
  // timeout-and-retry cycle is normal on cold start). Without this check,
  // every request that lands during that window blocks for the full
  // duration instead of failing fast, and any client with a shorter
  // timeout (a 5s health-check curl, a browser) gives up before it ever
  // resolves, showing up as a self-inflicted health-check failure on
  // every fresh restart, since almost no request's client is still
  // listening by the time the blocked call finally settles.
  if (!isFrankenConnected()) {
    res.status(503).json({
      error: { message: 'Pod is still starting up, hardware connecting' },
    });
    return;
  }

  try {
    const resp = await getDeviceStatusCoalesced();
    res.json(resp);
  } catch (error) {
    if (error instanceof FrankenCommandTimeoutError) {
      logger.warn(`/deviceStatus timed out: ${error.message}`);
      res.status(503).json({
        error: { message: 'Pod did not respond in time, retrying connection' },
      });
      return;
    }
    throw error;
  }
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

  await updateDeviceStatus(body as DeepPartial<DeviceStatus>);
  recordConfigAudit('device_status', 'POST /api/deviceStatus', validationResult.data);

  // If the user manually set a target temperature on a side, maybe pause the
  // remaining schedule (see scheduleOverride.markManualTempChange for rules).
  for (const side of ['left', 'right'] as const) {
    if (body?.[side]?.targetTemperatureF !== undefined) {
      await markManualTempChange(side, { to: body[side].targetTemperatureF });
    }
  }

  res.status(204).end();
});


export default router;
