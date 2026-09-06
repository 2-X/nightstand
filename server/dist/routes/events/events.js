import express from 'express';
import moment from 'moment-timezone';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import logger from '../../logger.js';
const router = express.Router();
const EventsQuerySchema = z.object({
    type: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
});
// GET /api/events?type=&startTime=&endTime=
// Returns pod_events with payload parsed from its stored JSON string.
router.get('/events', async (req, res) => {
    const parsed = EventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        logger.warn('Invalid /events query:', parsed.error);
        res.status(400).json({ error: 'Invalid request data', details: parsed.error.errors });
        return;
    }
    const { type, startTime, endTime } = parsed.data;
    const where = {};
    if (type)
        where.type = type;
    const timestamp = {};
    if (startTime)
        timestamp.gte = moment(startTime).unix();
    if (endTime)
        timestamp.lte = moment(endTime).unix();
    if (startTime || endTime)
        where.timestamp = timestamp;
    const rows = await prisma.pod_events.findMany({
        where,
        orderBy: { timestamp: 'asc' },
    });
    const events = rows.map((row) => ({
        ...row,
        payload: safeParse(row.payload),
    }));
    res.json(events);
});
// payload is written by the collector as JSON.stringify, but a hand-edited or
// legacy row could be non-JSON; fall back to the raw string rather than 500.
function safeParse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
export default router;
//# sourceMappingURL=events.js.map