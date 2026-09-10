import express from 'express';
import { z } from 'zod';
import { adaptiveStore } from '../8sleep/adaptiveState.js';
import { adaptiveStatus, acceptCirculation } from '../8sleep/adaptiveController.js';
const router = express.Router();
const configuration = z.object({ side: z.enum(['left', 'right']), mode: z.enum(['off', 'observe', 'active']),
    minimumF: z.number().int().min(55).max(110), maximumF: z.number().int().min(55).max(110) }).strict()
    .refine(value => value.minimumF <= value.maximumF, 'Minimum exceeds maximum');
router.get('/adaptive-temperature', (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json(adaptiveStatus());
});
router.post('/adaptive-temperature', (req, res) => {
    const parsed = configuration.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const { side, ...settings } = parsed.data;
    adaptiveStore.revision[side]++;
    Object.assign(adaptiveStore.data[side], settings);
    adaptiveStore.save();
    if (adaptiveStore.fault)
        return res.status(503).json({ error: adaptiveStore.fault });
    return res.json(adaptiveStatus());
});
router.post('/adaptive-temperature/circulation', (req, res) => {
    // Internal RAW-stream adapter only; the dashboard cannot manufacture healthy pumps.
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''))
        return res.sendStatus(403);
    const parsed = z.object({ at: z.number().finite(), left: z.boolean(), right: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success)
        return res.sendStatus(400);
    acceptCirculation(parsed.data);
    return res.sendStatus(204);
});
export default router;
//# sourceMappingURL=adaptiveTemperature.js.map