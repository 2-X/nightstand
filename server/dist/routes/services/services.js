import express from 'express';
import logger from '../../logger.js';
const router = express.Router();
import servicesDB, { updateServices } from '../../db/services.js';
import { ServicesSchema } from '../../db/servicesSchema.js';
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
    const data = await updateServices(body);
    res.status(200).json(data);
});
export default router;
//# sourceMappingURL=services.js.map