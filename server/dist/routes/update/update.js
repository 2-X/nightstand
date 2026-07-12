import express from 'express';
import fs from 'fs';
import logger from '../../logger.js';
import { triggerRollbackService } from '../../jobs/rollback.js';
import { triggerRevertToStockService } from '../../jobs/revertToStock.js';
const router = express.Router();
// The updater keeps the previous install here after every swap (see
// scripts/update.sh): reading its serverInfo.json is how we know whether an
// instant rollback is available and what it would roll back to.
const PREV_SERVER_INFO_PATH = '/home/dac/free-sleep-prev/server/src/serverInfo.json';
router.get('/rollback-info', async (_req, res) => {
    try {
        const raw = await fs.promises.readFile(PREV_SERVER_INFO_PATH, 'utf8');
        const version = JSON.parse(raw).version;
        const info = { available: !!version, version: version ?? null };
        res.json(info);
    }
    catch {
        // No PREV tree (fresh install, or this update's the first one), not an
        // error, just nothing to roll back to.
        const info = { available: false, version: null };
        res.json(info);
    }
});
router.post('/rollback', async (_req, res) => {
    try {
        triggerRollbackService();
        res.status(204).end();
    }
    catch (error) {
        logger.error('Failed to start rollback', error);
        res.status(500).json({ message: 'Unable to start rollback' });
    }
});
// Full revert to plain upstream free-sleep, undoing Nightstand entirely.
// Reversible only by re-adopting via scripts/migrate/switch-to-this-fork.sh
// afterward. There's no in-app way back once stock code is running.
router.post('/revert-to-stock', async (_req, res) => {
    try {
        triggerRevertToStockService();
        res.status(204).end();
    }
    catch (error) {
        logger.error('Failed to start revert to stock', error);
        res.status(500).json({ message: 'Unable to start revert to stock' });
    }
});
export default router;
//# sourceMappingURL=update.js.map