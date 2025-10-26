import express from 'express';
import moment from 'moment-timezone';
import { loadMovementRecords } from '../../db/loadMovementRecords.js';
import { prisma } from '../../db/prisma.js';
const router = express.Router();
router.get('/movement', async (req, res) => {
    const { startTime, endTime, side } = req.query;
    const query = {
        timestamp: {},
    };
    if (side)
        query.side = side;
    if (startTime) {
        query.timestamp = {
            gte: moment(startTime).unix(),
        };
    }
    if (endTime) {
        query.timestamp = {
            lte: moment(endTime).unix(),
        };
    }
    const movementRecords = await prisma.movement.findMany({
        where: query,
        orderBy: { timestamp: 'asc' },
    });
    const formattedRecords = await loadMovementRecords(movementRecords);
    res.json(formattedRecords);
});
export default router;
