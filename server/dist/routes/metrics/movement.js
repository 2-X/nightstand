import express from 'express';
import { legacyMovement, loadMovement } from '../../db/movement.js';
import { parseMetricsQuery } from './metricsQuery.js';
const router = express.Router();
router.get('/movement', async (req, res) => {
    const query = parseMetricsQuery(req.query);
    if (!query)
        return res.status(400).json({ error: 'Invalid side, startTime or endTime' });
    const movementRecords = await loadMovement(query.side, query.start, query.end);
    // Epoch seconds, as stored, matching the vitals route.
    res.json(legacyMovement(movementRecords));
});
export default router;
//# sourceMappingURL=movement.js.map