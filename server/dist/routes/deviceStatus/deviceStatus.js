
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="7ac032d3-1788-5130-aa1c-8af3b8966876")}catch(e){}}();
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
    await updateDeviceStatus(body);
    res.status(204).end();
});
export default router;
//# sourceMappingURL=deviceStatus.js.map
//# debugId=7ac032d3-1788-5130-aa1c-8af3b8966876
