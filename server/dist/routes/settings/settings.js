import _ from 'lodash';
import express from 'express';
import logger from '../../logger.js';
const router = express.Router();
import settingsDB, { updateSettings } from '../../db/settings.js';
import { SettingsSchema } from '../../db/settingsSchema.js';
import { wouldOrphanLevelFormat } from './settingsGuards.js';
import { syncRawArchiveConf } from '../../jobs/rawArchiveConf.js';
router.get('/settings', async (req, res) => {
    await settingsDB.read();
    res.json(settingsDB.data);
});
router.post('/settings', async (req, res) => {
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
    let conflict = false;
    const saved = await updateSettings(draft => {
        if (wouldOrphanLevelFormat(draft, validatedUpdate)) {
            conflict = true;
            return false;
        }
        _.merge(draft, validatedUpdate);
    }, async (draft) => {
        if (validatedUpdate.rawArchiveRetentionDays !== undefined) {
            await syncRawArchiveConf(draft.rawArchiveRetentionDays);
        }
    });
    if (conflict) {
        res.status(409).json({
            error: 'Set temperature display away from Level before disabling this feature',
        });
        return;
    }
    res.status(200).json(saved);
});
export default router;
//# sourceMappingURL=settings.js.map