import express from 'express';
import { prisma } from '../../db/prisma.js';
import { parseMetricsQuery } from './metricsQuery.js';
const router = express.Router();
router.get('/movement', async (req, res) => {
    const query = parseMetricsQuery(req.query);
    if (!query)
        return res.status(400).json({ error: 'Invalid side, startTime or endTime' });
    const movementRecords = await prisma.movement.findMany({
        where: { side: query.side, timestamp: { gte: query.start, lte: query.end } },
        orderBy: { timestamp: 'asc' },
    });
    // Epoch seconds, as stored, matching the vitals route.
    res.json(movementRecords);
});
export default router;
//# sourceMappingURL=movement.js.map