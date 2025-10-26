import express from 'express';
import moment from 'moment-timezone';
import { loadMovementRecords } from '../../db/loadMovementRecords.js';
import logger from '../../logger.js';
import { prisma } from '../../db/prisma.js';
const router = express.Router();
router.get('/movement', async (req, res) => {
    try {
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
    }
    catch (error) {
        logger.error('Error in GET /movement:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/movementdelete', async (req, res) => {
    try {
        await prisma.movement.deleteMany({});
        res.json({ msg: 'deleted rows!' });
    }
    catch (error) {
        logger.error('Error in GET /movement:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
export default router;
