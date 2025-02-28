import express from 'express';
import { getFranken } from '../../8sleep/frankenServer.js';
import { DeviceStatusSchema } from './deviceStatusSchema.js';
import logger from '../../logger.js';
import { updateDeviceStatus } from './updateDeviceStatus.js';
const router = express.Router();
router.get('/deviceStatus', async (req, res) => {
    const franken = await getFranken();
    const resp = await franken.getDeviceStatus();
    res.json(resp);
});
router.post('/deviceStatus', async (req, res) => {
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
    try {
        await updateDeviceStatus(body);
        res.status(204).end();
    }
    catch (error) {
        logger.error(error);
        res.status(500).json({ error });
    }
});
export default router;
