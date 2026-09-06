import express from 'express';
import moment from 'moment-timezone';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import logger from '../../logger.js';
const router = express.Router();
// ISO time -> epoch seconds, following routes/metrics/vitals.ts semantics
// (moment(isoString).unix()). zod validates presence/shape; the actual parse
// mirrors the sibling routes so the client can pass the same query params.
const TemperatureQuerySchema = z.object({
    side: z.enum(['left', 'right']).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    // Opt into hub samples even when a side filter is present.
    includeHub: z
        .union([z.literal('true'), z.literal('false')])
        .optional(),
});
// GET /api/metrics/temperature?side=&startTime=&endTime=&includeHub=
// Returns bed_state_samples, plus hub_state_samples under a `hub` key when no
// side filter is given (or includeHub=true is passed explicitly).
router.get('/temperature', async (req, res) => {
    const parsed = TemperatureQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        logger.warn('Invalid /metrics/temperature query:', parsed.error);
        res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
        return;
    }
    const { side, startTime, endTime, includeHub } = parsed.data;
    const bedWhere = {};
    if (side)
        bedWhere.side = side;
    const bedTimestamp = {};
    if (startTime)
        bedTimestamp.gte = moment(startTime).unix();
    if (endTime)
        bedTimestamp.lte = moment(endTime).unix();
    if (startTime || endTime)
        bedWhere.timestamp = bedTimestamp;
    const bed = await prisma.bed_state_samples.findMany({
        where: bedWhere,
        orderBy: { timestamp: 'asc' },
    });
    const wantHub = includeHub === 'true' || !side;
    if (!wantHub) {
        // Timestamps go out as stored epoch seconds (see the vitals route note).
        res.json(bed);
        return;
    }
    const hubTimestamp = {};
    if (startTime)
        hubTimestamp.gte = moment(startTime).unix();
    if (endTime)
        hubTimestamp.lte = moment(endTime).unix();
    const hub = await prisma.hub_state_samples.findMany({
        where: startTime || endTime ? { timestamp: hubTimestamp } : {},
        orderBy: { timestamp: 'asc' },
    });
    res.json({ bed, hub });
});
export default router;
//# sourceMappingURL=temperature.js.map