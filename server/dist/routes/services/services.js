import express from 'express';
import logger from '../../logger.js';
const router = express.Router();
import servicesDB, { updateServices } from '../../db/services.js';
import { ServicesSchema } from '../../db/servicesSchema.js';
import { shouldDisableBiometrics, triggerBiometricsDisable } from '../../jobs/biometrics.js';
router.get('/services', async (req, res) => {
    await servicesDB.read();
    res.json(servicesDB.data);
});
router.post('/services', async (req, res) => {
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
        triggerBiometricsDisable();
    }
    // Merge the validated/stripped result, not the raw body: StatusInfoSchema
    // (nested under biometrics.jobs.*) isn't `.strict()`, so extra properties
    // on a job status object would otherwise pass validation and get written
    // verbatim. Same bug class settings.ts's POST route was already fixed for.
    const data = await updateServices(validationResult.data);
    res.status(200).json(data);
});
export default router;
//# sourceMappingURL=services.js.map