import express from 'express';
import fs from 'fs';
import { z } from 'zod';
import logger from '../../logger.js';
import { triggerUpdateService } from '../../jobs/update.js';
import { triggerRollbackService } from '../../jobs/rollback.js';
import { triggerRevertToStockService } from '../../jobs/revertToStock.js';
import { UpdateRequestSchema, RollbackInfo } from './updateSchema.js';

import { PrivilegedCommandError, privilegedErrorStatus } from '../../jobs/privilegedCommand.js';

const router = express.Router();

// The updater keeps the previous install here after every swap (see
// scripts/update.sh): reading its serverInfo.json is how we know whether an
// instant rollback is available and what it would roll back to.
const PREV_SERVER_INFO_PATH = '/home/dac/free-sleep-prev/server/src/serverInfo.json';

// Consumed once by scripts/update.sh (deleted immediately after reading), so
// a stale file can never redirect a future plain update.
const TARGET_FILE = '/persistent/free-sleep-data/update-target.json';

const PrepareToStopSchema = z.object({ reason: z.enum(['downgrade', 'rollback', 'revert']) }).strict();
export type LeaveReason = 'downgrade' | 'rollback' | 'revert';
type LeaveHook = (reason: LeaveReason) => Promise<unknown>;
let leaveHook: LeaveHook | undefined;

// This file also ships in the updater overlay for stock installs, which has
// no Rhythms, so the server registers the handoff here at startup.
export function setLeaveHook(hook: LeaveHook): void {
  leaveHook = hook;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && /^(::ffff:)?127\.|^::1$/.test(address);
}

// The update, rollback and switch scripts call this just before they stop
// the server, after every check that could still abort them. The next
// version may not know Rhythms, so this server hands any sleep it started
// back to the weekly schedule. A failure never stops the script; the
// firmware off time set at power-on is the backstop.
router.post('/prepare-to-stop', async (req, res) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Only the Pod itself can prepare the server to stop' });
    return;
  }
  const parsed = PrepareToStopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
    return;
  }
  const { reason } = parsed.data;
  try {
    await leaveHook?.(reason);
  } catch (error) {
    logger.error(`Rhythms handoff before ${reason} failed, continuing`, error);
  }
  res.status(204).end();
});

router.post('/', async (req, res) => {
  const parsed = UpdateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.error('Invalid update request:', parsed.error);
    res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
    return;
  }

  const { targetVersion, allowDowngrade } = parsed.data;
  let ownsTarget = false;
  try {
    await triggerUpdateService({
      beforeStart: async () => {
        if (targetVersion) {
          ownsTarget = true;
          await fs.promises.writeFile(
            TARGET_FILE,
            JSON.stringify({ version: targetVersion, allowDowngrade: !!allowDowngrade })
          );
        }
      },
      onStartFailure: async () => {
        if (ownsTarget) await fs.promises.unlink(TARGET_FILE).catch(() => undefined);
      },
    });
    res.status(204).end();
  } catch (error) {
    logger.error('Failed to start update', error);
    res.status(privilegedErrorStatus(error)).json({
      message: error instanceof PrivilegedCommandError ? error.message : 'Unable to start update',
    });
  }
});

router.get('/rollback-info', async (_req, res) => {
  try {
    const raw = await fs.promises.readFile(PREV_SERVER_INFO_PATH, 'utf8');
    const version = (JSON.parse(raw) as { version?: string }).version;
    const info: RollbackInfo = { available: !!version, version: version ?? null };
    res.json(info);
  } catch {
    // No PREV tree (fresh install, or this update's the first one), not an
    // error, just nothing to roll back to.
    const info: RollbackInfo = { available: false, version: null };
    res.json(info);
  }
});

router.post('/rollback', async (_req, res) => {
  try {
    await triggerRollbackService();
    res.status(204).end();
  } catch (error) {
    logger.error('Failed to start rollback', error);
    res.status(privilegedErrorStatus(error)).json({
      message: error instanceof PrivilegedCommandError ? error.message : 'Unable to start rollback',
    });
  }
});

// Switch the app to upstream free-sleep. System configuration and backups can remain.
// Reversible only by re-adopting via scripts/migrate/switch-to-this-fork.sh
// afterward. There's no in-app way back once upstream free-sleep is running.
router.post('/revert-to-stock', async (_req, res) => {
  try {
    await triggerRevertToStockService();
    res.status(204).end();
  } catch (error) {
    logger.error('Could not start switching to upstream free-sleep.', error);
    res.status(privilegedErrorStatus(error)).json({
      message: error instanceof PrivilegedCommandError ? error.message : 'Could not start switching to upstream free-sleep.',
    });
  }
});

export default router;
